import MobileBottomNav from './MobileBottomNav';
import Sidebar from './Sidebar';
import TopSearchBar from './TopSearchBar';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  return (
    <div className='w-full min-h-screen bg-[#0f0f0f]'>
      {/* 顶部搜索栏 - 在所有设备上显示 */}
      <TopSearchBar />

      {/* 移动端头部 (fixed) */}
      {/* <MobileHeader showBackButton={['/play'].includes(activePath)} /> */}

      {/* 桌面端 YouTube 风格顶部导航栏 (fixed) - 已隐藏 */}
      {/* <YouTubeTopNavbar activePath={activePath} /> */}

      {/* 主内容区域 - YouTube 风格布局 */}
      <div className='relative min-w-0 transition-all duration-300'>
        {/* 桌面端侧边栏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 桌面端左上角返回按钮 */}
        {/* {['/play'].includes(activePath) && (
          <div className='absolute top-3 left-1 z-20 hidden md:flex'>
            <BackButton />
          </div>
        )} */}

        {/* 主内容容器 - YouTube 风格布局 */}
        <main className='mb-14 md:mb-0 md:pl-64 pt-2'>
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
