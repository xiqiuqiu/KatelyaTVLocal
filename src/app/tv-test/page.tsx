'use client';

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

const SAMPLE_URL =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  label: string;
  status: CheckStatus;
  value: string;
}

interface PlaybackStats {
  resolution: string;
  firstFrameMs: number | null;
  waitingCount: number;
  droppedFrames: number | null;
  totalFrames: number | null;
}

interface BrowserEnvironment {
  userAgent: string;
  viewport: string;
  screen: string;
  deviceMemory: string;
}

interface VideoWithWebkitFullscreen extends HTMLVideoElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

const initialStats: PlaybackStats = {
  resolution: '等待播放',
  firstFrameMs: null,
  waitingCount: 0,
  droppedFrames: null,
  totalFrames: null,
};

function mediaSourceSupports(type: string): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function' &&
    MediaSource.isTypeSupported(type)
  );
}

function collectChecks(): CheckResult[] {
  const video = document.createElement('video');
  const hlsSupported = Hls.isSupported();
  const nativeHls = Boolean(
    video.canPlayType('application/vnd.apple.mpegurl') ||
      video.canPlayType('application/x-mpegURL')
  );
  const avcSupported = mediaSourceSupports('video/mp4; codecs="avc1.640028"');
  const aacSupported = mediaSourceSupports('audio/mp4; codecs="mp4a.40.2"');
  const hevcSupported = mediaSourceSupports(
    'video/mp4; codecs="hvc1.1.6.L120.B0"'
  );
  const av1Supported = mediaSourceSupports('video/mp4; codecs="av01.0.08M.08"');

  return [
    {
      label: 'MediaSource / MSE',
      status: typeof MediaSource !== 'undefined' ? 'pass' : 'fail',
      value: typeof MediaSource !== 'undefined' ? '可用' : '不可用',
    },
    {
      label: 'hls.js',
      status: hlsSupported ? 'pass' : 'fail',
      value: hlsSupported ? '可用' : '不可用',
    },
    {
      label: '原生 HLS',
      status: nativeHls ? 'pass' : 'warn',
      value: nativeHls ? '浏览器声明支持' : '未声明支持',
    },
    {
      label: 'H.264 High L4.0',
      status: avcSupported ? 'pass' : 'fail',
      value: avcSupported ? '支持' : '不支持',
    },
    {
      label: 'AAC-LC',
      status: aacSupported ? 'pass' : 'fail',
      value: aacSupported ? '支持' : '不支持',
    },
    {
      label: 'H.265 / HEVC',
      status: hevcSupported ? 'pass' : 'warn',
      value: hevcSupported ? '浏览器声明支持' : '未声明支持',
    },
    {
      label: 'AV1',
      status: av1Supported ? 'pass' : 'warn',
      value: av1Supported ? '浏览器声明支持' : '未声明支持',
    },
    {
      label: 'Web Worker',
      status: typeof Worker !== 'undefined' ? 'pass' : 'warn',
      value: typeof Worker !== 'undefined' ? '可用' : '不可用',
    },
  ];
}

function collectEnvironment(): BrowserEnvironment {
  const browserNavigator = navigator as NavigatorWithDeviceMemory;

  return {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    screen: `${window.screen.width} × ${window.screen.height} @ ${
      window.devicePixelRatio || 1
    }x`,
    deviceMemory: browserNavigator.deviceMemory
      ? `${browserNavigator.deviceMemory} GB（浏览器估算）`
      : '未提供',
  };
}

function statusClass(status: CheckStatus): string {
  if (status === 'pass') {
    return 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'fail') {
    return 'border-red-400/50 bg-red-400/10 text-red-100';
  }
  return 'border-amber-400/50 bg-amber-400/10 text-amber-100';
}

export default function TvHlsTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const firstFrameRecordedRef = useRef(false);
  const lastStatsSecondRef = useRef(-1);

  const [source, setSource] = useState(SAMPLE_URL);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [environment, setEnvironment] = useState<BrowserEnvironment | null>(
    null
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [playbackStatus, setPlaybackStatus] = useState('尚未开始');
  const [stats, setStats] = useState<PlaybackStats>(initialStats);

  useEffect(() => {
    const querySource = new URLSearchParams(window.location.search).get('src');
    if (querySource) setSource(querySource);
    setChecks(collectChecks());
    setEnvironment(collectEnvironment());

    return () => {
      hlsRef.current?.destroy();
    };
  }, []);

  const appendLog = (message: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((current) => [`${time}  ${message}`, ...current].slice(0, 16));
  };

  const resetPlayer = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    startedAtRef.current = null;
    firstFrameRecordedRef.current = false;
    lastStatsSecondRef.current = -1;
    setStats(initialStats);

    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  const tryPlay = async (video: HTMLVideoElement) => {
    try {
      await video.play();
    } catch {
      setPlaybackStatus('等待遥控器点击播放');
      appendLog('浏览器阻止了自动播放，请点击视频或“播放”按钮');
    }
  };

  const startTest = (force1080p: boolean) => {
    const url = source.trim();
    if (!url) {
      setPlaybackStatus('请输入 HLS 地址');
      return;
    }

    try {
      new URL(url);
    } catch {
      setPlaybackStatus('HLS 地址无效');
      return;
    }

    resetPlayer();
    setLogs([]);
    setPlaybackStatus('正在连接 HLS');
    startedAtRef.current = performance.now();
    appendLog(`开始测试：${url}`);

    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: typeof Worker !== 'undefined',
        lowLatencyMode: false,
        maxBufferLength: 30,
        backBufferLength: 15,
        maxBufferSize: 30 * 1000 * 1000,
        manifestLoadingTimeOut: 12000,
        fragLoadingTimeOut: 30000,
      });

      hlsRef.current = hls;
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        appendLog('hls.js 已连接 video，开始加载清单');
        hls.loadSource(url);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (force1080p && data.levels.length > 0) {
          const highestLevelIndex = data.levels.reduce(
            (bestIndex, level, index, levels) => {
              const bestLevel = levels[bestIndex];
              const area = level.width * level.height;
              const bestArea = bestLevel.width * bestLevel.height;

              if (area > bestArea) return index;
              if (area === bestArea && level.bitrate < bestLevel.bitrate) {
                return index;
              }
              return bestIndex;
            },
            0
          );
          const highestLevel = data.levels[highestLevelIndex];
          hls.currentLevel = highestLevelIndex;
          appendLog(
            `清单解析成功，测试 ${highestLevel.width} × ${
              highestLevel.height
            } / ${Math.round(highestLevel.bitrate / 1000)} kbps`
          );
        } else if (force1080p) {
          appendLog('清单没有可选清晰度，使用默认档');
        } else {
          appendLog(`清单解析成功，自适应 ${data.levels.length} 档`);
        }
        setPlaybackStatus('清单成功，等待首帧');
        void tryPlay(video);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        appendLog(
          `hls.js ${data.fatal ? '致命' : '非致命'}错误：${data.type} / ${
            data.details
          }`
        );
        if (data.fatal) setPlaybackStatus('HLS 播放失败');
      });
      hls.attachMedia(video);
      return;
    }

    const nativeHls = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL')
    );
    if (nativeHls) {
      appendLog('MSE 不可用，改用浏览器原生 HLS');
      video.src = url;
      void tryPlay(video);
      return;
    }

    setPlaybackStatus('浏览器不支持当前 HLS 方案');
    appendLog('hls.js 与原生 HLS 均不可用');
  };

  const updatePlaybackStats = () => {
    const video = videoRef.current;
    if (!video) return;

    const currentSecond = Math.floor(video.currentTime);
    if (currentSecond === lastStatsSecondRef.current) return;
    lastStatsSecondRef.current = currentSecond;

    const quality = video.getVideoPlaybackQuality?.();
    setStats((current) => ({
      ...current,
      resolution:
        video.videoWidth && video.videoHeight
          ? `${video.videoWidth} × ${video.videoHeight}`
          : current.resolution,
      droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null,
    }));
  };

  const enterFullscreen = async () => {
    const video = videoRef.current as VideoWithWebkitFullscreen | null;
    if (!video) return;

    try {
      if (video.requestFullscreen) {
        await video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        await video.webkitRequestFullscreen();
      } else {
        appendLog('浏览器没有提供全屏 API');
      }
    } catch {
      appendLog('进入全屏失败');
    }
  };

  const copyReport = async () => {
    const report = JSON.stringify(
      { environment, checks, playbackStatus, stats, logs },
      null,
      2
    );

    try {
      await navigator.clipboard.writeText(report);
      appendLog('诊断结果已复制');
    } catch {
      appendLog('浏览器不支持复制，请直接拍摄页面结果');
    }
  };

  const firstFrameLabel =
    stats.firstFrameMs === null ? '等待' : `${stats.firstFrameMs} ms`;

  return (
    <main className='min-h-dvh bg-[#07110f] px-5 py-7 text-[#f4f1df] sm:px-8 lg:px-12'>
      <div className='mx-auto max-w-[1500px]'>
        <header className='mb-8 border-b border-[#d5ff5f]/25 pb-6'>
          <p className='mb-2 text-lg font-semibold tracking-[0.18em] text-[#d5ff5f]'>
            KATELYATV · PROTOTYPE
          </p>
          <h1 className='text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl'>
            电视浏览器 HLS 诊断
          </h1>
          <p className='mt-4 max-w-4xl text-xl leading-relaxed text-[#b8c8c2]'>
            用于确认创维 Q7F Pro 的浏览器是否具备 MSE、H.264、AAC 和 hls.js
            播放能力。先运行诊断，再播放公开 1080p 样片。
          </p>
        </header>

        <section className='mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {checks.map((check) => (
            <div
              key={check.label}
              className={`rounded-2xl border p-5 ${statusClass(check.status)}`}
            >
              <p className='text-base opacity-75'>{check.label}</p>
              <p className='mt-2 text-2xl font-bold'>{check.value}</p>
            </div>
          ))}
        </section>

        <section className='mb-8 rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-7'>
          <label
            className='mb-3 block text-lg font-bold text-[#d5ff5f]'
            htmlFor='hls-source'
          >
            HLS 测试地址
          </label>
          <input
            id='hls-source'
            className='min-h-16 w-full rounded-xl border border-white/20 bg-black/30 px-5 text-lg text-white outline-none focus:border-[#d5ff5f] focus:ring-4 focus:ring-[#d5ff5f]/20'
            value={source}
            onChange={(event) => setSource(event.target.value)}
            inputMode='url'
          />
          <div className='mt-5 flex flex-wrap gap-4'>
            <button
              className='min-h-16 rounded-xl bg-[#d5ff5f] px-7 text-lg font-black text-[#07110f] outline-none focus:ring-4 focus:ring-white'
              type='button'
              onClick={() => startTest(true)}
            >
              1080p 压力测试
            </button>
            <button
              className='min-h-16 rounded-xl border border-[#d5ff5f]/60 bg-[#d5ff5f]/10 px-7 text-lg font-bold text-[#eaffad] outline-none focus:ring-4 focus:ring-[#d5ff5f]'
              type='button'
              onClick={() => startTest(false)}
            >
              自适应测试
            </button>
            <button
              className='min-h-16 rounded-xl border border-white/25 bg-white/10 px-7 text-lg font-bold outline-none focus:ring-4 focus:ring-[#d5ff5f]'
              type='button'
              onClick={() => {
                const video = videoRef.current;
                if (video) void tryPlay(video);
              }}
            >
              播放
            </button>
            <button
              className='min-h-16 rounded-xl border border-white/25 bg-white/10 px-7 text-lg font-bold outline-none focus:ring-4 focus:ring-[#d5ff5f]'
              type='button'
              onClick={() => videoRef.current?.pause()}
            >
              暂停
            </button>
            <button
              className='min-h-16 rounded-xl border border-white/25 bg-white/10 px-7 text-lg font-bold outline-none focus:ring-4 focus:ring-[#d5ff5f]'
              type='button'
              onClick={() => void enterFullscreen()}
            >
              全屏
            </button>
            <button
              className='min-h-16 rounded-xl border border-white/25 bg-white/10 px-7 text-lg font-bold outline-none focus:ring-4 focus:ring-[#d5ff5f]'
              type='button'
              onClick={() => {
                setChecks(collectChecks());
                setEnvironment(collectEnvironment());
                appendLog('浏览器能力已重新检测');
              }}
            >
              重新检测
            </button>
          </div>
        </section>

        <section className='grid gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]'>
          <div>
            <div className='overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl'>
              <video
                ref={videoRef}
                className='aspect-video w-full bg-black'
                controls
                playsInline
                preload='metadata'
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  appendLog(
                    `媒体信息就绪：${video?.videoWidth || 0} × ${
                      video?.videoHeight || 0
                    }`
                  );
                }}
                onCanPlay={() => {
                  setPlaybackStatus('可以播放');
                  appendLog('浏览器触发 canplay');
                }}
                onPlaying={() => {
                  setPlaybackStatus('正在播放');
                  if (
                    !firstFrameRecordedRef.current &&
                    startedAtRef.current !== null
                  ) {
                    firstFrameRecordedRef.current = true;
                    const firstFrameMs = Math.round(
                      performance.now() - startedAtRef.current
                    );
                    setStats((current) => ({ ...current, firstFrameMs }));
                    appendLog(`首帧成功：${firstFrameMs} ms`);
                  }
                }}
                onWaiting={() => {
                  setStats((current) => ({
                    ...current,
                    waitingCount: current.waitingCount + 1,
                  }));
                  appendLog('播放发生 waiting');
                }}
                onTimeUpdate={updatePlaybackStats}
                onError={() => {
                  const error = videoRef.current?.error;
                  setPlaybackStatus('video 元素播放失败');
                  appendLog(`video 错误码：${error?.code || '未知'}`);
                }}
              />
            </div>

            <div className='mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              {[
                ['状态', playbackStatus],
                ['实际分辨率', stats.resolution],
                ['首帧耗时', firstFrameLabel],
                ['卡顿次数', String(stats.waitingCount)],
                [
                  '掉帧',
                  stats.droppedFrames === null
                    ? '浏览器未提供'
                    : `${stats.droppedFrames} / ${stats.totalFrames}`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className='rounded-2xl border border-white/10 bg-white/[0.04] p-5'
                >
                  <p className='text-base text-[#90a49d]'>{label}</p>
                  <p className='mt-2 break-words text-xl font-bold'>{value}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className='space-y-6'>
            <section className='rounded-3xl border border-white/10 bg-white/[0.04] p-6'>
              <h2 className='text-2xl font-black'>设备信息</h2>
              <dl className='mt-5 space-y-4 text-lg'>
                <div>
                  <dt className='text-[#90a49d]'>屏幕</dt>
                  <dd className='break-words font-bold'>
                    {environment?.screen || '检测中'}
                  </dd>
                </div>
                <div>
                  <dt className='text-[#90a49d]'>视口</dt>
                  <dd className='font-bold'>
                    {environment?.viewport || '检测中'}
                  </dd>
                </div>
                <div>
                  <dt className='text-[#90a49d]'>内存提示</dt>
                  <dd className='font-bold'>
                    {environment?.deviceMemory || '检测中'}
                  </dd>
                </div>
                <div>
                  <dt className='text-[#90a49d]'>User-Agent</dt>
                  <dd className='mt-1 break-all text-base leading-relaxed'>
                    {environment?.userAgent || '检测中'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className='rounded-3xl border border-white/10 bg-black/30 p-6'>
              <div className='flex items-center justify-between gap-4'>
                <h2 className='text-2xl font-black'>运行日志</h2>
                <button
                  className='min-h-12 rounded-lg border border-white/20 px-4 font-bold outline-none focus:ring-4 focus:ring-[#d5ff5f]'
                  type='button'
                  onClick={() => void copyReport()}
                >
                  复制结果
                </button>
              </div>
              <ol className='mt-5 space-y-3 font-mono text-sm leading-relaxed text-[#c7d5d0]'>
                {logs.length ? (
                  logs.map((log, index) => (
                    <li key={`${log}-${index}`} className='break-all'>
                      {log}
                    </li>
                  ))
                ) : (
                  <li>点击任一测试按钮开始记录。</li>
                )}
              </ol>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
