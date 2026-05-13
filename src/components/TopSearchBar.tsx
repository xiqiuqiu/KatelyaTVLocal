'use client';

import { Menu, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface TopSearchBarProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const TopSearchBar = ({
  isSidebarCollapsed = true,
  onToggleSidebar,
}: TopSearchBarProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header
      className='sticky top-0 z-[9999] border-b border-white/10 bg-[rgba(8,10,14,0.82)] shadow-[0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl'
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className='mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 md:px-6 lg:px-8'>
        <div className='flex-shrink-0'>
          <button
            onClick={onToggleSidebar}
            aria-pressed={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className='inline-flex h-11 w-11 items-center justify-center rounded-ui-sm border border-white/10 bg-white/5 text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
          >
            <Menu size={20} />
          </button>
        </div>

        <div className='hidden flex-shrink-0 md:flex'>
          <button
            onClick={() => router.push('/')}
            className='text-sm font-semibold uppercase tracking-[0.24em] text-[rgb(var(--ui-text))] transition hover:text-[rgb(var(--ui-accent-warm))]'
          >
            {siteName}
          </button>
        </div>

        <form
          role='search'
          onSubmit={handleSearch}
          className='mx-auto flex max-w-3xl flex-1 items-center rounded-full border border-white/10 bg-white/5 p-1 shadow-ui-soft'
        >
          <div className='flex-1'>
            <input
              type='text'
              placeholder='搜索影片、电视剧、综艺...'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className='h-11 w-full rounded-full border-0 bg-transparent px-5 text-sm text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted))] focus:outline-none focus:ring-0'
            />
          </div>
          <button
            type='submit'
            aria-label='提交搜索'
            className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ui-accent))] text-white transition hover:brightness-110'
          >
            <Search size={18} />
          </button>
        </form>

        <div className='flex flex-shrink-0 items-center gap-1 sm:gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default TopSearchBar;
