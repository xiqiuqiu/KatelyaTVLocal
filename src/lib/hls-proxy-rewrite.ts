export type HlsMediaSegmentMode = 'proxy' | 'direct';

export interface RewritePlaylistContentOptions {
  mediaSegmentMode?: HlsMediaSegmentMode;
}

function buildAbsoluteUrl(input: string, baseUrl: string): string {
  return new URL(input, baseUrl).toString();
}

function shouldProxyUriAttribute(line: string, absoluteUrl: string): boolean {
  const lowerPath = new URL(absoluteUrl).pathname.toLowerCase();

  return (
    lowerPath.endsWith('.m3u8') ||
    line.startsWith('#EXT-X-MEDIA') ||
    line.startsWith('#EXT-X-I-FRAME-STREAM-INF')
  );
}

function rewritePlaylistAttributes(
  line: string,
  baseUrl: string,
  proxyPrefix: string,
  mediaSegmentMode: HlsMediaSegmentMode
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    const absoluteUrl = buildAbsoluteUrl(uri, baseUrl);

    if (
      mediaSegmentMode === 'direct' &&
      !shouldProxyUriAttribute(line.trim(), absoluteUrl)
    ) {
      return `URI="${absoluteUrl}"`;
    }

    return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
  });
}

export function rewritePlaylistContent(
  content: string,
  baseUrl: string,
  proxyPrefix: string,
  options: RewritePlaylistContentOptions = {}
): string {
  const mediaSegmentMode = options.mediaSegmentMode || 'proxy';
  const outputLines: string[] = [];
  let nextUriIsPlaylist = false;

  content.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      outputLines.push(rawLine);
      return;
    }

    if (line.startsWith('#')) {
      outputLines.push(
        rewritePlaylistAttributes(
          rawLine,
          baseUrl,
          proxyPrefix,
          mediaSegmentMode
        )
      );
      nextUriIsPlaylist =
        line.startsWith('#EXT-X-STREAM-INF') ||
        line.startsWith('#EXT-X-I-FRAME-STREAM-INF');
      return;
    }

    const absoluteUrl = buildAbsoluteUrl(line, baseUrl);
    const isPlaylist =
      nextUriIsPlaylist || new URL(absoluteUrl).pathname.toLowerCase().endsWith('.m3u8');
    nextUriIsPlaylist = false;

    if (mediaSegmentMode === 'direct' && !isPlaylist) {
      outputLines.push(absoluteUrl);
      return;
    }

    outputLines.push(`${proxyPrefix}${encodeURIComponent(absoluteUrl)}`);
  });

  return outputLines.join('\n');
}
