'use client';

import { useEffect, useMemo, useState } from 'react';

import MobileBottomNav from '@/components/MobileBottomNav';
import Sidebar from '@/components/Sidebar';
import TopSearchBar from '@/components/TopSearchBar';

interface AppShellProps {
  activePath?: string;
  children: React.ReactNode;
}

export default function AppShell({
  children,
  activePath = '/',
}: AppShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

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
    <div className='ui-app-bg ui-breathing-canvas min-h-screen text-[rgb(var(--ui-text))]'>
      <TopSearchBar
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className='relative z-10 min-h-screen overflow-x-hidden pt-[calc(4rem+env(safe-area-inset-top))]'>
        <div className='hidden md:block'>
          <Sidebar
            activePath={activePath}
            onToggle={setIsSidebarCollapsed}
            collapsed={isSidebarCollapsed}
            showCollapseToggle={false}
          />
        </div>
        <main
          className={`min-w-0 ${desktopOffsetClass}`}
        >
          <div
            className='ui-reveal mx-auto w-full max-w-[1600px] px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8'
            style={{
              paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))',
            }}
          >
            {children}
          </div>
        </main>
      </div>
      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
}
