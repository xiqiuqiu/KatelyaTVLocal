'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const TopSearchBar = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');

  // 从 URL 参数中获取搜索词并设置到搜索框
  useEffect(() => {
    const currentQuery = searchParams.get('q');
    if (currentQuery) {
      setQuery(currentQuery);
    }
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className='w-full bg-[#0f0f0f] border-b border-[#333333] sticky top-0 z-[9999]'>
      <div className='h-14 flex items-center px-4 md:px-6 lg:px-8'>
        {/* Logo - 左侧，在小屏幕上隐藏 */}
        <div className='hidden md:flex flex-shrink-0 mr-4 lg:mr-6'>
          <button
            onClick={() => router.push('/')}
            className='text-white font-bold text-lg lg:text-xl hover:text-[#3ea6ff] transition-colors cursor-pointer'
          >
            LOVETVIE
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
                  className='w-full h-10 px-4 bg-[#121212] border border-[#333333] rounded-l-full text-white placeholder-[#717171] text-sm focus:border-[#3ea6ff] focus:outline-none transition-colors'
                />
              </div>
              <button
                type='submit'
                className='px-4 bg-[#222222] border border-l-0 border-[#333333] rounded-r-full hover:bg-[#3a3a3a] transition-colors flex items-center justify-center'
              >
                <Search size={18} className='text-[#aaaaaa]' />
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
