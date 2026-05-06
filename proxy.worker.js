/* eslint-disable */

const PLAYLIST_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return handleOptionsRequest();
    }

    if (url.pathname === '/api/source-probe') {
      return handleSourceProbe(request, url);
    }

    if (url.pathname === '/api/hls-proxy') {
      return handleHlsProxy(request, url);
    }

    // 如果访问根目录，返回HTML
    if (url.pathname === '/') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    // 从请求路径中提取目标 URL
    let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

    // 判断用户输入的 URL 是否带有协议
    actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

    // 保留查询参数
    actualUrlStr += url.search;

    // 创建新 Headers 对象，排除以 'cf-' 开头的请求头
    const newHeaders = filterHeaders(
      request.headers,
      (name) => !name.startsWith('cf-')
    );

    // 创建一个新的请求以访问目标 URL
    const modifiedRequest = new Request(actualUrlStr, {
      headers: newHeaders,
      method: request.method,
      body: request.body,
      redirect: 'manual',
    });

    // 发起对目标 URL 的请求
    const response = await fetch(modifiedRequest);
    let body = response.body;

    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      body = response.body;
      // 创建新的 Response 对象以修改 Location 头部
      return handleRedirect(response, body);
    } else if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(
        response,
        url.protocol,
        url.host,
        actualUrlStr
      );
    }

    // 创建修改后的响应对象
    const modifiedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    // 添加禁用缓存的头部
    setNoCacheHeaders(modifiedResponse.headers);

    // 添加 CORS 头部，允许跨域访问
    setCorsHeaders(modifiedResponse.headers);

    return modifiedResponse;
  } catch (error) {
    // 如果请求目标地址时出现错误，返回带有错误消息的响应和状态码 500（服务器错误）
    return jsonResponse(
      {
        error: error.message,
      },
      500
    );
  }
}

async function handleSourceProbe(request, requestUrl) {
  const targetUrl = requestUrl.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing source URL' }, 400);
  }

  try {
    const origin = request.headers.get('origin') || requestUrl.origin;
    const upstreamResponse = await fetch(targetUrl, {
      headers: buildMediaHeaders(targetUrl),
      redirect: 'follow',
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return jsonResponse(
        {
          kind: 'unavailable',
          reason: `上游响应失败: ${upstreamResponse.status}`,
          domain: new URL(targetUrl).hostname.toLowerCase(),
          upstreamStatus: upstreamResponse.status,
        },
        200
      );
    }

    const domain = new URL(targetUrl).hostname.toLowerCase();
    const playlistResponse = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('Content-Type')
    );
    const playlistCorsAccessible = isCorsAccessible(upstreamResponse, origin);

    if (!playlistResponse) {
      return jsonResponse(
        {
          kind: playlistCorsAccessible ? 'direct' : 'proxy',
          reason: playlistCorsAccessible
            ? '媒体地址可直接跨域访问'
            : '媒体地址可拉取，但浏览器跨域受限',
          domain,
          upstreamStatus: upstreamResponse.status,
        },
        200
      );
    }

    const playlistContent = await upstreamResponse.text();
    const nextTarget = getFirstPlaylistTarget(playlistContent, targetUrl);

    if (!nextTarget) {
      return jsonResponse(
        {
          kind: playlistCorsAccessible ? 'direct' : 'proxy',
          reason: playlistCorsAccessible
            ? '播放列表可直接访问'
            : '播放列表缺少跨域头，需走代理',
          domain,
          upstreamStatus: upstreamResponse.status,
        },
        200
      );
    }

    const nestedProbe = await probeNestedTarget(nextTarget, origin);

    if (!nestedProbe.ok) {
      return jsonResponse(
        {
          kind: 'unavailable',
          reason: `首个媒体片段不可达: ${nestedProbe.status}`,
          domain,
          upstreamStatus: nestedProbe.status,
        },
        200
      );
    }

    const canDirect = playlistCorsAccessible && nestedProbe.corsAccessible;
    return jsonResponse(
      {
        kind: canDirect ? 'direct' : 'proxy',
        reason: canDirect
          ? '播放列表和首个媒体片段都支持浏览器直连'
          : '上游可用，但至少一层缺少浏览器跨域头，建议走代理',
        domain,
        upstreamStatus: upstreamResponse.status,
      },
      200
    );
  } catch (error) {
    return jsonResponse(
      {
        kind: 'unavailable',
        reason: error.message || '探测失败',
      },
      200
    );
  }
}

async function handleHlsProxy(request, requestUrl) {
  const targetUrl = requestUrl.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing HLS URL' }, 400);
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      headers: buildMediaHeaders(targetUrl, request.headers.get('range')),
      redirect: 'follow',
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return jsonResponse(
        {
          error: 'Upstream request failed',
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
        },
        upstreamResponse.status
      );
    }

    if (!upstreamResponse.body) {
      return jsonResponse({ error: 'Upstream response has no body' }, 502);
    }

    const proxyPrefix = `${requestUrl.origin}/api/hls-proxy?url=`;
    const isPlaylist = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('Content-Type')
    );

    if (isPlaylist) {
      const playlistContent = await upstreamResponse.text();
      const rewrittenPlaylist = rewritePlaylistContent(
        playlistContent,
        targetUrl,
        proxyPrefix
      );
      const response = new Response(rewrittenPlaylist, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: createHlsProxyHeaders(upstreamResponse, true),
      });

      setCorsHeaders(response.headers);
      return response;
    }

    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: createHlsProxyHeaders(upstreamResponse, false),
    });

    setCorsHeaders(response.headers);
    return response;
  } catch (error) {
    return jsonResponse(
      {
        error: error.message || 'Proxy request failed',
      },
      500
    );
  }
}

// 确保 URL 带有协议
function ensureProtocol(url, defaultProtocol) {
  return url.startsWith('http://') || url.startsWith('https://')
    ? url
    : defaultProtocol + '//' + url;
}

// 处理重定向
function handleRedirect(response, body) {
  const location = new URL(response.headers.get('location'));
  const modifiedLocation = `/${encodeURIComponent(location.toString())}`;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...response.headers,
      Location: modifiedLocation,
    },
  });
}

// 处理 HTML 内容中的相对路径
async function handleHtmlContent(response, protocol, host, actualUrlStr) {
  const originalText = await response.text();
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  let modifiedText = replaceRelativePaths(
    originalText,
    protocol,
    host,
    new URL(actualUrlStr).origin
  );

  return modifiedText;
}

// 替换 HTML 内容中的相对路径
function replaceRelativePaths(text, protocol, host, origin) {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

function isPlaylistResponse(targetUrl, contentType) {
  const normalizedContentType = (contentType || '').toLowerCase();

  return (
    PLAYLIST_CONTENT_TYPES.some((item) =>
      normalizedContentType.includes(item)
    ) || targetUrl.toLowerCase().includes('.m3u8')
  );
}

function buildAbsoluteUrl(input, baseUrl) {
  return new URL(input, baseUrl).toString();
}

function buildMediaHeaders(targetUrl, rangeHeader) {
  const headers = new Headers();

  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }

  headers.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  );
  headers.set('Referer', new URL(targetUrl).origin);
  headers.set('Accept', '*/*');

  return headers;
}

function isCorsAccessible(response, origin) {
  const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
  if (!allowOrigin) return false;
  if (allowOrigin === '*') return true;

  return allowOrigin
    .split(',')
    .map((value) => value.trim())
    .includes(origin);
}

function getFirstPlaylistTarget(content, baseUrl) {
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    return buildAbsoluteUrl(line, baseUrl);
  }

  return null;
}

async function probeNestedTarget(targetUrl, origin) {
  const isNestedPlaylist = targetUrl.toLowerCase().includes('.m3u8');
  const response = await fetch(targetUrl, {
    headers: buildMediaHeaders(
      targetUrl,
      isNestedPlaylist ? null : 'bytes=0-1'
    ),
    redirect: 'follow',
  });

  return {
    ok: response.ok || response.status === 206,
    corsAccessible: isCorsAccessible(response, origin),
    status: response.status,
  };
}

function rewritePlaylistAttributes(line, baseUrl, proxyPrefix) {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    const absoluteUrl = buildAbsoluteUrl(uri, baseUrl);
    return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
  });
}

function rewritePlaylistContent(content, baseUrl, proxyPrefix) {
  return content
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return rawLine;

      if (line.startsWith('#')) {
        return rewritePlaylistAttributes(rawLine, baseUrl, proxyPrefix);
      }

      const absoluteUrl = buildAbsoluteUrl(line, baseUrl);
      return `${proxyPrefix}${encodeURIComponent(absoluteUrl)}`;
    })
    .join('\n');
}

function createHlsProxyHeaders(upstreamResponse, isPlaylist) {
  const headers = new Headers();
  const passthroughHeaderNames = [
    'Accept-Ranges',
    'Content-Length',
    'Content-Range',
    'Content-Type',
    'ETag',
    'Last-Modified',
  ];

  passthroughHeaderNames.forEach((headerName) => {
    if (
      isPlaylist &&
      (headerName === 'Content-Length' || headerName === 'Content-Range')
    ) {
      return;
    }

    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  if (isPlaylist) {
    headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=30, s-maxage=30');
  } else {
    headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  }

  return headers;
}

// 返回 JSON 格式的响应
function jsonResponse(data, status) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
  });
  setCorsHeaders(headers);
  setNoCacheHeaders(headers);

  return new Response(JSON.stringify(data), {
    status: status,
    headers,
  });
}

function handleOptionsRequest() {
  const headers = new Headers();
  setCorsHeaders(headers);

  return new Response(null, {
    status: 204,
    headers,
  });
}

// 过滤请求头
function filterHeaders(headers, filterFunc) {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

// 设置禁用缓存的头部
function setNoCacheHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
}

// 设置 CORS 头部
function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  headers.set('Access-Control-Allow-Headers', '*');
}

// 返回根目录的 HTML
function getRootHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>Proxy Everything</title>
  <link rel="icon" type="image/png" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="Description" content="Proxy Everything with CF Workers.">
  <meta property="og:description" content="Proxy Everything with CF Workers.">
  <meta property="og:image" content="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Content-Language" content="zh-CN">
  <meta name="copyright" content="Copyright © ymyuuu">
  <meta name="author" content="ymyuuu">
  <link rel="apple-touch-icon-precomposed" sizes="120x120" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <style>
      body, html {
          height: 100%;
          margin: 0;
      }
      .background {
          background-image: url('https://imgapi.cn/bing.php');
          background-size: cover;
          background-position: center;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
      }
      .card {
          background-color: rgba(255, 255, 255, 0.8);
          transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card:hover {
          background-color: rgba(255, 255, 255, 1);
          box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
      }
      .input-field input[type=text] {
          color: #2c3e50;
      }
      .input-field input[type=text]:focus+label {
          color: #2c3e50 !important;
      }
      .input-field input[type=text]:focus {
          border-bottom: 1px solid #2c3e50 !important;
          box-shadow: 0 1px 0 0 #2c3e50 !important;
      }
  </style>
</head>
<body>
  <div class="background">
      <div class="container">
          <div class="row">
              <div class="col s12 m8 offset-m2 l6 offset-l3">
                  <div class="card">
                      <div class="card-content">
                          <span class="card-title center-align"><i class="material-icons left">link</i>Proxy Everything</span>
                          <form id="urlForm" onsubmit="redirectToProxy(event)">
                              <div class="input-field">
                                  <input type="text" id="targetUrl" placeholder="在此输入目标地址" required>
                                  <label for="targetUrl">目标地址</label>
                              </div>
                              <button type="submit" class="btn waves-effect waves-light teal darken-2 full-width">跳转</button>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
      function redirectToProxy(event) {
          event.preventDefault();
          const targetUrl = document.getElementById('targetUrl').value.trim();
          const currentOrigin = window.location.origin;
          window.open(currentOrigin + '/' + encodeURIComponent(targetUrl), '_blank');
      }
  </script>
</body>
</html>`;
}
