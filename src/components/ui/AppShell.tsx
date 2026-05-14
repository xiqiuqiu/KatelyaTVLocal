'use client';

import { useMemo, useState } from 'react';

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    if (typeof window.__sidebarCollapsed === 'boolean') {
      return window.__sidebarCollapsed;
    }

    const saved = window.localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      window.__sidebarCollapsed = parsed;
      return parsed;
    }

    return true;
  });

  const desktopOffsetClass = useMemo(() => {
    return isSidebarCollapsed ? 'md:pl-20' : 'md:pl-64';
  }, [isSidebarCollapsed]);

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.__sidebarCollapsed = next;
        window.localStorage.setItem('sidebarCollapsed', JSON.stringify(next));
      }
      return next;
    });
  };

  return (
    <div className='ui-app-bg min-h-screen text-[rgb(var(--ui-text))]'>
      <TopSearchBar
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className='relative min-h-[calc(100vh-4rem)]'>
        <div className='hidden md:block transition-all duration-300'>
          <Sidebar
            activePath={activePath}
            onToggle={setIsSidebarCollapsed}
            collapsed={isSidebarCollapsed}
            showCollapseToggle={false}
          />
        </div>
        <main
          className={`min-w-0 transition-[padding] duration-300 ${desktopOffsetClass}`}
        >
          <div
            className='mx-auto w-full max-w-[1600px] px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8'
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
