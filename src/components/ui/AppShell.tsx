'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildTvModeHref,
  TV_MODE_PREFERENCE_COOKIE,
} from '@/lib/tv-interaction';

import MobileBottomNav from '@/components/MobileBottomNav';
import Sidebar from '@/components/Sidebar';
import TopSearchBar from '@/components/TopSearchBar';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

interface AppShellProps {
  activePath?: string;
  children: React.ReactNode;
  tvMode?: boolean;
  modeHref?: string;
}

export default function AppShell({
  children,
  activePath = '/',
  tvMode = false,
  modeHref = activePath,
}: AppShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const browsePage = ['/', '/history', '/search'].includes(activePath);
  useTvBrowseNavigation(rootRef, tvMode && browsePage, activePath);

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get('tv');
    if (mode !== '0' && mode !== '1') return;
    document.cookie = `${TV_MODE_PREFERENCE_COOKIE}=${
      mode === '0' ? 'web' : ''
    }; Path=/; SameSite=Lax; Max-Age=${mode === '0' ? 31536000 : 0}`;
  }, [tvMode, modeHref]);

  useEffect(() => {
    if (typeof window.__sidebarCollapsed === 'boolean') {
      setIsSidebarCollapsed(window.__sidebarCollapsed);
      return;
    }

    const saved = window.localStorage.getItem('sidebarCollapsed');
    if (saved === null) {
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'boolean') {
        window.__sidebarCollapsed = parsed;
        setIsSidebarCollapsed(parsed);
      }
    } catch {
      window.localStorage.removeItem('sidebarCollapsed');
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (activePath !== '/play') {
      root.classList.remove('play-overscroll-lock');
      return;
    }

    root.classList.add('play-overscroll-lock');
    return () => {
      root.classList.remove('play-overscroll-lock');
    };
  }, [activePath]);

  const desktopOffsetClass = useMemo(() => {
    return isSidebarCollapsed ? 'md:pl-20' : 'md:pl-64';
  }, [isSidebarCollapsed]);

  const handleToggleSidebar = () => {
    const next = !isSidebarCollapsed;
    window.__sidebarCollapsed = next;
    window.localStorage.setItem('sidebarCollapsed', JSON.stringify(next));
    setIsSidebarCollapsed(next);
  };

  return (
    <div
      ref={rootRef}
      data-tv-mode={tvMode}
      data-tv-browse={tvMode && browsePage}
      className='ui-app-bg ui-breathing-canvas min-h-dvh text-[rgb(var(--ui-text))]'
    >
      {!tvMode && (
        <TopSearchBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
        />
      )}
      <div
        className={`relative z-10 min-h-dvh overflow-x-hidden ${
          tvMode ? '' : 'pt-[calc(4rem+env(safe-area-inset-top))]'
        }`}
      >
        {!tvMode && (
          <div className='hidden md:block'>
            <Sidebar
              activePath={activePath}
              onToggle={setIsSidebarCollapsed}
              collapsed={isSidebarCollapsed}
              showCollapseToggle={false}
            />
          </div>
        )}
        <main className={`min-w-0 ${tvMode ? '' : desktopOffsetClass}`}>
          <div
            className={`ui-reveal mx-auto w-full max-w-[1600px] ${
              tvMode ? 'px-5 py-5' : 'px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8'
            }`}
            style={{
              paddingBottom: tvMode
                ? '1.25rem'
                : 'calc(5rem + env(safe-area-inset-bottom))',
            }}
          >
            {tvMode ? (
              <nav
                aria-label='电视导航'
                className='mb-6 flex flex-wrap items-center gap-4'
              >
                <Link
                  href='/?tv=1'
                  data-tv-focus-key='nav-home'
                  data-tv-back={(browsePage && activePath !== '/') || undefined}
                  aria-current={activePath === '/' ? 'page' : undefined}
                  className='inline-flex min-h-12 items-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.28)] px-5 text-lg font-semibold'
                >
                  首页
                </Link>
                <Link
                  href='/history?tv=1'
                  data-tv-focus-key='nav-history'
                  aria-current={activePath === '/history' ? 'page' : undefined}
                  className='inline-flex min-h-12 items-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.28)] px-5 text-lg font-semibold'
                >
                  播放历史
                </Link>
                <Link
                  href='/search?tv=1'
                  data-tv-focus-key='nav-search'
                  aria-current={activePath === '/search' ? 'page' : undefined}
                  className='inline-flex min-h-12 items-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.28)] px-5 text-lg font-semibold'
                >
                  搜索
                </Link>
                {browsePage && (
                  <Link
                    href={buildTvModeHref(modeHref, false)}
                    data-tv-focus-key='nav-exit'
                    className='ml-auto inline-flex min-h-12 items-center rounded-ui-sm px-5 text-lg'
                  >
                    退出电视模式
                  </Link>
                )}
              </nav>
            ) : browsePage ? (
              <div className='mb-4 flex justify-end'>
                <Link
                  href={buildTvModeHref(modeHref, true)}
                  className='inline-flex min-h-11 items-center rounded-full border border-[rgb(var(--ui-border)/0.28)] px-4 text-sm font-semibold'
                >
                  电视模式
                </Link>
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>
      {!tvMode && (
        <div className='md:hidden'>
          <MobileBottomNav activePath={activePath} />
        </div>
      )}
    </div>
  );
}
