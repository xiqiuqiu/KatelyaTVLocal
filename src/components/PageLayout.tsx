import MobileBottomNav from './MobileBottomNav';
import Sidebar from './Sidebar';
import TopSearchBar from './TopSearchBar';
import { useEffect, useState } from 'react';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  useEffect(() => {
    const handleSidebarVisibilityChange = (event: CustomEvent) => {
      setIsSidebarVisible(event.detail.visible);
    };

    window.addEventListener('sidebarVisibilityChange', handleSidebarVisibilityChange as EventListener);

    return () => {
      window.removeEventListener('sidebarVisibilityChange', handleSidebarVisibilityChange as EventListener);
    };
  }, []);

  return (
    <div className='w-full min-h-screen bg-white dark:bg-black'>
      {/* 顶部搜索栏 - 在所有设备上显示 */}
      <TopSearchBar />
      {/* 主内容区域 - YouTube 风格布局 */}
      <div className='relative min-w-0 transition-all duration-300'>
        {/* 桌面端侧边栏 */}
        <div className={`hidden md:block transition-all duration-300 ${
          isSidebarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主内容容器 - YouTube 风格布局 */}
        <main className={`mb-14 md:mb-0 pt-2 transition-all duration-300 ${
          isSidebarVisible ? 'md:pl-64' : 'md:pl-0'
        }`}>
          <div className='flex w-full min-h-screen'>
            {/* 主内容区 - 全宽度 */}
            <div className='flex-1 w-full'>
              <div
                className='p-4 md:p-6 lg:p-8'
                style={{
                  paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* 移动端底部导航 */}
      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
};

export default PageLayout;
