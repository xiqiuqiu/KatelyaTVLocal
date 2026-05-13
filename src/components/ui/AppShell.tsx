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
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  const desktopOffsetClass = useMemo(() => {
    if (!isSidebarVisible) {
      return 'md:pl-0';
    }

    return isSidebarCollapsed ? 'md:pl-20' : 'md:pl-64';
  }, [isSidebarCollapsed, isSidebarVisible]);

  return (
    <div className='ui-app-bg min-h-screen text-[rgb(var(--ui-text))]'>
      <TopSearchBar
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={() => setIsSidebarVisible((current) => !current)}
      />
      <div className='relative min-h-[calc(100vh-4rem)]'>
        <div
          className={`hidden md:block transition-all duration-300 ${
            isSidebarVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <Sidebar
            activePath={activePath}
            onToggle={setIsSidebarCollapsed}
            visible={isSidebarVisible}
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
