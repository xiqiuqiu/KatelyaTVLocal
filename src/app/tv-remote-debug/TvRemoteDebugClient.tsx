'use client';

import { useEffect, useRef, useState } from 'react';

import { resolveTvRemoteClickTarget } from '@/lib/tv-interaction';

interface RemoteEvent {
  id: number;
  receivedAt: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

type Panel = 'episodes' | 'sources' | 'settings' | null;

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) return '';
  return (
    target.getAttribute('aria-label') ||
    target.textContent?.trim().slice(0, 40) ||
    target.tagName
  );
}

const focusClass =
  'focus:scale-[1.03] focus:border-[#d5ff5f] focus:bg-[#d5ff5f] focus:text-[#07110f] focus:outline-none focus:shadow-[0_0_0_5px_rgba(213,255,95,0.25)]';
const controlClass = `min-h-16 rounded-2xl border-2 border-white/15 bg-white/[0.06] px-4 text-lg font-semibold transition ${focusClass}`;

export default function TvRemoteDebugClient() {
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelOriginRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [sessionId, setSessionId] = useState('');
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(42);
  const [episode, setEpisode] = useState(3);
  const [source, setSource] = useState('线路 A');
  const [favorite, setFavorite] = useState(false);
  const [notice, setNotice] = useState('等待遥控器操作');

  useEffect(() => {
    const currentSessionId = `tv-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    let lastMoveAt = 0;
    let pendingRemoteClickTarget: HTMLElement | null = null;
    setSessionId(currentSessionId);

    const send = (eventType: string, payload: Record<string, unknown> = {}) => {
      void fetch('/api/tv-remote-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSessionId,
          eventType,
          payload,
        }),
        keepalive: true,
      }).catch(() => setConnected(false));
    };

    const closeActivePanel = (reason: string, target: EventTarget | null) => {
      if (!panelRef.current) return false;

      send('panel-dismiss', {
        reason,
        target: describeTarget(target),
      });
      if (window.history.state?.tvPanel) window.history.back();
      else setPanel(null);
      return true;
    };

    const onKey = (event: KeyboardEvent) => {
      send(event.type, {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        repeat: event.repeat,
        location: event.location,
        target: describeTarget(event.target),
        activeElement: describeTarget(document.activeElement),
      });

      if (
        event.type === 'keydown' &&
        (['Escape', 'BrowserBack', 'GoBack', 'Back'].includes(event.key) ||
          event.keyCode === 4) &&
        closeActivePanel('back-key', event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onFocus = (event: FocusEvent) => {
      send(event.type, {
        target: describeTarget(event.target),
        relatedTarget: describeTarget(event.relatedTarget),
      });
      if (event.type === 'focusin' && event.target instanceof HTMLElement) {
        if (panelRef.current && !panelRef.current.contains(event.target)) {
          if (
            pendingRemoteClickTarget &&
            panelRef.current.contains(pendingRemoteClickTarget)
          ) {
            pendingRemoteClickTarget.focus();
            return;
          }
          if (closeActivePanel('focus-escape', event.target)) return;
        }
        event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    const onMouse = (event: MouseEvent) => {
      if (event.type === 'mousemove') {
        const now = performance.now();
        if (now - lastMoveAt < 150) return;
        lastMoveAt = now;
      }
      send(event.type, {
        target: describeTarget(event.target),
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (
        event.type === 'click' &&
        pendingRemoteClickTarget &&
        event.target !== pendingRemoteClickTarget
      ) {
        const target = pendingRemoteClickTarget;
        pendingRemoteClickTarget = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        send('remote-click-redirect', {
          from: describeTarget(event.target),
          to: describeTarget(target),
        });
        target.focus();
        target.click();
        return;
      }
      if (event.type === 'click') pendingRemoteClickTarget = null;
    };

    const onPointer = (event: PointerEvent) => {
      send(event.type, {
        target: describeTarget(event.target),
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (event.type === 'pointerdown') {
        pendingRemoteClickTarget = resolveTvRemoteClickTarget({
          pointerType: event.pointerType,
          activeElement: document.activeElement,
          eventTarget: event.target,
        });
      }
    };

    const onTouch = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      send(event.type, {
        target: describeTarget(event.target),
        touches: event.touches.length,
        clientX: touch?.clientX,
        clientY: touch?.clientY,
      });
    };

    const onVisibility = () => {
      send('visibilitychange', {
        visibilityState: document.visibilityState,
      });
    };

    const onPopState = (event: PopStateEvent) => {
      send('popstate', { state: event.state, url: window.location.href });
      setPanel(null);
    };

    const onPage = (event: PageTransitionEvent) => {
      send(event.type, { persisted: event.persisted });
    };

    const onResize = () => {
      send('resize', {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
    };

    const onFullscreen = () => {
      send('fullscreenchange', {
        fullscreen: Boolean(document.fullscreenElement),
      });
    };

    send('session-start', {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${window.screen.width}x${window.screen.height}`,
      devicePixelRatio: window.devicePixelRatio,
      historyLength: window.history.length,
      userAgent: navigator.userAgent,
    });
    firstControlRef.current?.focus();

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('focusout', onFocus, true);
    window.addEventListener('click', onMouse, true);
    window.addEventListener('dblclick', onMouse, true);
    window.addEventListener('contextmenu', onMouse, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('mouseup', onMouse, true);
    window.addEventListener('mousemove', onMouse, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointerup', onPointer, true);
    window.addEventListener('touchstart', onTouch, true);
    window.addEventListener('touchend', onTouch, true);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPage);
    window.addEventListener('pageshow', onPage);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);

    const poll = window.setInterval(() => {
      void fetch(
        `/api/tv-remote-debug?sessionId=${encodeURIComponent(
          currentSessionId
        )}`,
        { cache: 'no-store' }
      )
        .then((response) => response.json())
        .then((result: { events?: RemoteEvent[] }) => {
          setEvents((result.events || []).slice(-30).reverse());
          setConnected(true);
        })
        .catch(() => setConnected(false));
    }, 1000);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', onFocus, true);
      window.removeEventListener('click', onMouse, true);
      window.removeEventListener('dblclick', onMouse, true);
      window.removeEventListener('contextmenu', onMouse, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('mouseup', onMouse, true);
      window.removeEventListener('mousemove', onMouse, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointerup', onPointer, true);
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('touchend', onTouch, true);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPage);
      window.removeEventListener('pageshow', onPage);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  useEffect(() => {
    if (panel) {
      window.setTimeout(() => {
        panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }, 0);
      return;
    }
    panelOriginRef.current?.focus();
  }, [panel]);

  const openPanel = (nextPanel: Exclude<Panel, null>) => {
    panelOriginRef.current = document.activeElement as HTMLElement | null;
    window.history.pushState(
      { tvPanel: nextPanel },
      '',
      `${window.location.pathname}${window.location.search}#${nextPanel}`
    );
    setPanel(nextPanel);
    setNotice(
      `已打开${
        nextPanel === 'episodes'
          ? '选集'
          : nextPanel === 'sources'
          ? '换源'
          : '设置'
      }面板`
    );
  };

  const closePanel = () => {
    if (window.history.state?.tvPanel) {
      window.history.back();
      return;
    }
    setPanel(null);
  };

  const enterFullscreen = async () => {
    try {
      await mainRef.current?.requestFullscreen();
      setNotice('已进入网页全屏');
    } catch {
      setNotice('浏览器拒绝了网页全屏');
    }
  };

  const panelTitle =
    panel === 'episodes'
      ? '选择集数'
      : panel === 'sources'
      ? '切换线路'
      : '电视设置';

  return (
    <main
      ref={mainRef}
      className='min-h-dvh overflow-x-hidden bg-[#07110f] px-6 py-6 text-[#f4f1df]'
    >
      <div className='mx-auto max-w-[1500px]'>
        <header className='mb-6 flex items-start justify-between gap-6 border-b border-[#d5ff5f]/25 pb-5'>
          <div>
            <p className='text-base font-semibold tracking-[0.18em] text-[#d5ff5f]'>
              TV INTERACTION · LOCAL DEBUG
            </p>
            <h1 className='mt-2 text-3xl font-semibold'>电视端交互模拟</h1>
            <p className='mt-2 text-lg text-[#b8c8c2]'>
              模拟播放控制、选集、换源、弹层、焦点恢复和浏览器返回。
            </p>
          </div>
          <div
            className={`rounded-full border px-4 py-2 text-base font-semibold ${
              connected
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                : 'border-amber-400/50 bg-amber-400/10 text-amber-100'
            }`}
          >
            {connected ? '日志已连接' : '正在连接'}
          </div>
        </header>

        <div className='grid gap-6 xl:grid-cols-[1.45fr_1fr]'>
          <section className='space-y-5'>
            <div className='overflow-hidden rounded-3xl border border-white/15 bg-black shadow-2xl'>
              <div className='relative flex aspect-video min-h-64 items-center justify-center bg-[radial-gradient(circle_at_center,#183a31_0%,#07110f_65%)]'>
                <div className='text-center'>
                  <p className='text-lg text-[#b8c8c2]'>
                    正在播放 · 第 {episode} 集
                  </p>
                  <p className='mt-3 text-4xl font-semibold'>
                    {playing ? '播放中' : '已暂停'}
                  </p>
                  <p className='mt-3 text-lg text-[#d5ff5f]'>{source}</p>
                </div>
                <div className='absolute inset-x-6 bottom-5'>
                  <div className='h-2 overflow-hidden rounded-full bg-white/15'>
                    <div
                      className='h-full bg-[#d5ff5f]'
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className='mt-2 flex justify-between text-sm text-white/60'>
                    <span>{Math.round((progress / 100) * 48)}:00</span>
                    <span>48:00</span>
                  </div>
                </div>
              </div>
            </div>

            <div className='grid grid-cols-4 gap-3'>
              <button
                ref={firstControlRef}
                type='button'
                aria-label='快退十秒'
                className={controlClass}
                onClick={() => {
                  setProgress((value) => Math.max(0, value - 5));
                  setNotice('快退 10 秒');
                }}
              >
                -10 秒
              </button>
              <button
                type='button'
                aria-label={playing ? '暂停' : '播放'}
                className={controlClass}
                onClick={() => {
                  setPlaying((value) => !value);
                  setNotice(playing ? '已暂停' : '开始播放');
                }}
              >
                {playing ? '暂停' : '播放'}
              </button>
              <button
                type='button'
                aria-label='快进十秒'
                className={controlClass}
                onClick={() => {
                  setProgress((value) => Math.min(100, value + 5));
                  setNotice('快进 10 秒');
                }}
              >
                +10 秒
              </button>
              <button
                type='button'
                aria-label={favorite ? '取消收藏' : '收藏'}
                className={controlClass}
                onClick={() => {
                  setFavorite((value) => !value);
                  setNotice(favorite ? '已取消收藏' : '已收藏');
                }}
              >
                {favorite ? '已收藏' : '收藏'}
              </button>
              <button
                type='button'
                aria-label='打开选集面板'
                className={controlClass}
                onClick={() => openPanel('episodes')}
              >
                选集
              </button>
              <button
                type='button'
                aria-label='打开换源面板'
                className={controlClass}
                onClick={() => openPanel('sources')}
              >
                换源
              </button>
              <button
                type='button'
                aria-label='打开电视设置'
                className={controlClass}
                onClick={() => openPanel('settings')}
              >
                设置
              </button>
              <button
                type='button'
                aria-label='进入网页全屏'
                className={controlClass}
                onClick={() => void enterFullscreen()}
              >
                全屏
              </button>
            </div>

            <div className='grid grid-cols-3 gap-3'>
              {['返回首页', '搜索影片', '播放历史'].map((label) => (
                <button
                  key={label}
                  type='button'
                  aria-label={label}
                  className={controlClass}
                  onClick={() => setNotice(`已触发：${label}`)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className='rounded-2xl border border-[#d5ff5f]/25 bg-[#d5ff5f]/10 px-5 py-4 text-lg text-[#eaffaa]'>
              当前状态：{notice}
            </div>
          </section>

          <section>
            <h2 className='mb-4 text-2xl font-semibold'>服务器已收到的日志</h2>
            <div className='h-[650px] overflow-y-auto rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-sm'>
              {events.length === 0 ? (
                <p className='text-white/50'>等待遥控器事件……</p>
              ) : (
                <div className='space-y-2'>
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className='rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2'
                    >
                      <div className='flex justify-between gap-4 text-[#d5ff5f]'>
                        <span>{event.eventType}</span>
                        <span className='text-white/45'>
                          {new Date(event.receivedAt).toLocaleTimeString(
                            'zh-CN',
                            { hour12: false }
                          )}
                        </span>
                      </div>
                      <pre className='mt-1 whitespace-pre-wrap break-all text-white/70'>
                        {JSON.stringify(event.payload || {}, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className='mt-3 break-all text-xs text-white/40'>
              会话：{sessionId || '正在初始化'}
            </p>
          </section>
        </div>
      </div>

      {panel && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-8 py-8 backdrop-blur-sm'
          role='dialog'
          aria-modal='true'
          aria-label={panelTitle}
        >
          <div
            ref={panelRef}
            className='max-h-full w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/15 bg-[#0b1815] p-7 shadow-2xl'
          >
            <div className='mb-6 flex items-center justify-between gap-5'>
              <div>
                <p className='text-sm font-semibold tracking-[0.18em] text-[#d5ff5f]'>
                  TV PANEL
                </p>
                <h2 className='mt-2 text-3xl font-semibold'>{panelTitle}</h2>
              </div>
              <button
                type='button'
                aria-label={`关闭${panelTitle}`}
                className={controlClass}
                onClick={closePanel}
              >
                关闭
              </button>
            </div>

            {panel === 'episodes' && (
              <div className='grid grid-cols-4 gap-3'>
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (number) => (
                    <button
                      key={number}
                      type='button'
                      aria-label={`选择第 ${number} 集`}
                      className={`${controlClass} ${
                        episode === number
                          ? 'border-[#d5ff5f] text-[#d5ff5f]'
                          : ''
                      }`}
                      onClick={() => {
                        setEpisode(number);
                        setNotice(`已切换到第 ${number} 集`);
                        closePanel();
                      }}
                    >
                      第 {number} 集
                    </button>
                  )
                )}
              </div>
            )}

            {panel === 'sources' && (
              <div className='grid grid-cols-2 gap-4'>
                {['线路 A', '线路 B', '线路 C', '线路 D'].map((item) => (
                  <button
                    key={item}
                    type='button'
                    aria-label={`切换到${item}`}
                    className={`${controlClass} min-h-24 ${
                      source === item ? 'border-[#d5ff5f] text-[#d5ff5f]' : ''
                    }`}
                    onClick={() => {
                      setSource(item);
                      setNotice(`已切换到${item}`);
                      closePanel();
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            {panel === 'settings' && (
              <div className='grid grid-cols-2 gap-4'>
                {['画面比例', '清晰度 1080P', '字幕设置', '退出电视模式'].map(
                  (item) => (
                    <button
                      key={item}
                      type='button'
                      aria-label={item}
                      className={`${controlClass} min-h-24`}
                      onClick={() => setNotice(`已触发设置：${item}`)}
                    >
                      {item}
                    </button>
                  )
                )}
              </div>
            )}

            <p className='mt-6 text-lg text-white/55'>
              请在面板打开时按遥控器返回键，验证浏览器是否触发 popstate。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
