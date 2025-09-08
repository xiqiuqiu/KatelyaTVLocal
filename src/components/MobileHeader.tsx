'use client';

import { useSite } from './SiteProvider';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className='md:hidden relative w-full bg-[#0f0f0f] border-b border-[#333333]'>
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左侧：返回按钮 */}
        {/* <div className='flex items-center gap-2'>
          {showBackButton && <BackButton />}
        </div> */}

        {/* 中间：网站名称 */}
        {/* <div className='flex-1 text-center'>
          <span className='text-lg font-bold text-white tracking-tight'>
            {siteName}
          </span>
        </div> */}

        {/* 右侧：预留空间保持对称 */}
        {/* <div className='w-16'></div> */}
      </div>
    </header>
  );
};

export default MobileHeader;
