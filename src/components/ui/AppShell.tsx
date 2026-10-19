'use client';

import { Compass, Heart, History, Home, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  buildTvModeHref,
  TV_MODE_PREFERENCE_COOKIE,
} from '@/lib/tv-interaction';
import {
  catalogNavigationItems,
  isNavigationItemActive,
} from '@/lib/ui/navigation';

import MobileBottomNav from '@/components/MobileBottomNav';
import Sidebar from '@/components/Sidebar';
import { useSite } from '@/components/SiteProvider';
import TopSearchBar from '@/components/TopSearchBar';
import { UserMenu } from '@/components/UserMenu';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

interface AppShellProps {
  activePath?: string;
  children: React.ReactNode;
  tvMode?: boolean;
  modeHref?: string;
}

const tvNavigation = [
  { href: '/', label: '首页', key: 'home', icon: Home },
  { href: '/douban?type=movie', label: '发现', key: 'discover', icon: Compass },
  { href: '/search', label: '搜索', key: 'search', icon: Search },
  { href: '/?tab=favorites', label: '收藏夹', key: 'favorites', icon: Heart },
  { href: '/history', label: '播放历史', key: 'history', icon: History },
];

export default function AppShell({
  children,
  activePath = '/',
  tvMode = false,
  modeHref,
}: AppShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { siteName } = useSite();
  const browsePage =
    ['/', '/?tab=favorites', '/history', '/search', '/admin'].includes(
      activePath
    ) || activePath.startsWith('/douban');
  useTvBrowseNavigation(
    rootRef,
    tvMode && browsePage,
    activePath,
    activePath === '/admin'
  );

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
    if (saved === null) return;
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
      className='ui-app-bg min-h-dvh text-[rgb(var(--ui-text))]'
    >
      {!tvMode && (
        <TopSearchBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          onOpenMenu={() => setMenuOpen(true)}
          menuOpen={menuOpen}
          modeHref={modeHref}
        />
      )}
      <div className={`relative min-h-dvh ${tvMode ? '' : 'ui-shell-body'}`}>
        {!tvMode && (
          <div className='hidden md:block'>
            <Sidebar
              activePath={activePath}
              onToggle={setIsSidebarCollapsed}
              collapsed={isSidebarCollapsed}
              showCollapseToggle={false}
              onOpenMenu={() => setMenuOpen(true)}
            />
          </div>
        )}
        <main
          id='main-content'
          className={`min-w-0 ${
            tvMode ? '' : isSidebarCollapsed ? 'md:pl-20' : 'md:pl-44'
          }`}
        >
          <div className='ui-shell-content'>
            {tvMode && (
              <nav aria-label='电视导航' className='ui-tv-nav'>
                <span className='ui-brand'>{siteName}</span>
                {tvNavigation.map(({ href, label, key, icon: Icon }) => (
                  <Link
                    key={key}
                    href={buildTvModeHref(href, true)}
                    data-tv-focus-key={`nav-${key}`}
                    data-tv-back={
                      (key === 'home' && browsePage && activePath !== '/') ||
                      undefined
                    }
                    aria-current={
                      isNavigationItemActive(activePath, href)
                        ? 'page'
                        : undefined
                    }
                    data-active={isNavigationItemActive(activePath, href)}
                    className='ui-nav-item'
                  >
                    <Icon aria-hidden className='h-6 w-6' />
                    {label}
                  </Link>
                ))}
                {browsePage && (
                  <button
                    type='button'
                    className='ui-nav-item'
                    aria-haspopup='dialog'
                    aria-expanded={menuOpen}
                    data-tv-focus-key='nav-settings'
                    onClick={() => setMenuOpen(true)}
                  >
                    <Settings aria-hidden className='h-6 w-6' />
                    设置
                  </button>
                )}
                {browsePage && (
                  <Link
                    href={buildTvModeHref(modeHref || activePath, false)}
                    data-tv-focus-key='nav-exit'
                    className='ui-nav-item ml-auto'
                  >
                    退出电视模式
                  </Link>
                )}
              </nav>
            )}
            {activePath.startsWith('/douban') && (
              <nav aria-label='影片分类' className='mb-6 flex flex-wrap gap-2'>
                {catalogNavigationItems.map((item) => (
                  <Link
                    key={item.key}
                    href={buildTvModeHref(item.href, tvMode)}
                    data-active={isNavigationItemActive(activePath, item.href)}
                    aria-current={
                      isNavigationItemActive(activePath, item.href)
                        ? 'page'
                        : undefined
                    }
                    className='ui-nav-item'
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            {children}
          </div>
        </main>
      </div>
      {!tvMode && (
        <div className='md:hidden'>
          <MobileBottomNav
            activePath={activePath}
            onOpenMenu={() => setMenuOpen(true)}
            menuOpen={menuOpen}
          />
        </div>
      )}
      <UserMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        tvMode={tvMode}
        modeHref={modeHref}
      />
    </div>
  );
}
