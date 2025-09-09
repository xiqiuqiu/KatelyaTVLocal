'use client';

import { Menu, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const TopSearchBar = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  // 从 URL 参数中获取搜索词并设置到搜索框
  useEffect(() => {
    const currentQuery = searchParams.get('q');
    if (currentQuery) {
      setQuery(currentQuery);
    }
  }, [searchParams]);

  const toggleSidebar = () => {
    setIsSidebarVisible(!isSidebarVisible);
    // 触发全局事件让其他组件知道侧边栏状态变化
    window.dispatchEvent(
      new CustomEvent('sidebarVisibilityChange', {
        detail: { visible: !isSidebarVisible },
      })
    );
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className='w-full bg-white dark:bg-black border-b border-gray-200 dark:border-gray-800 sticky top-0 z-[9999]'>
      <div className='h-14 flex items-center px-4 md:px-6 lg:px-8'>
        {/* 汉堡菜单按钮 - 左侧 */}
        <div className='flex-shrink-0 mr-3 md:mr-4'>
          <button
            onClick={toggleSidebar}
            className='p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200'
            aria-label='切换侧边栏'
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Logo - 左侧，在小屏幕上隐藏 */}
        <div className='hidden md:flex flex-shrink-0 mr-4 lg:mr-6'>
          <button
            onClick={() => router.push('/')}
            className='text-gray-900 dark:text-white font-bold text-lg lg:text-xl hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer'
          >
            ZOTUBE
          </button>
        </div>

        {/* 搜索表单 - 居中显示 */}
        <div className='flex-1 max-w-2xl mx-auto'>
          <form onSubmit={handleSearch} className='w-full'>
            <div className='flex'>
              <div className='flex-1 relative'>
                <input
                  type='text'
                  placeholder='搜索影片、电视剧、综艺...'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className='w-full h-10 px-4 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-l-full text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none transition-colors'
                />
              </div>
              <button
                type='submit'
                className='px-4 bg-gray-200 dark:bg-gray-800 border border-l-0 border-gray-300 dark:border-gray-700 rounded-r-full hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors flex items-center justify-center'
              >
                <Search
                  size={18}
                  className='text-gray-600 dark:text-gray-400'
                />
              </button>
            </div>
          </form>
        </div>

        {/* 右侧工具栏 - 主题切换和用户菜单 */}
        <div className='flex-shrink-0 ml-4 lg:ml-6 flex items-center gap-1 sm:gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </div>
  );
};

export default TopSearchBar;
