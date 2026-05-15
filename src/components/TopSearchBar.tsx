'use client';

import { Menu, Search } from 'lucide-react';
import Image from 'next/image';
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
      className='ui-topbar-glass fixed inset-x-0 top-0 z-[9999]'
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className='relative z-10 grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 md:block md:px-0'>
        <div className='flex flex-shrink-0 justify-center md:absolute md:left-0 md:top-0 md:h-16 md:w-20 md:items-center'>
          <button
            onClick={onToggleSidebar}
            aria-pressed={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className='inline-flex h-11 w-11 items-center justify-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-surface)/0.42)] text-[rgb(var(--ui-text-muted))] shadow-ui-soft backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[rgb(var(--ui-accent)/0.36)] hover:bg-[rgb(var(--ui-surface-strong)/0.52)] hover:text-[rgb(var(--ui-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent'
          >
            <Menu size={20} />
          </button>
        </div>

        <div className='hidden min-w-0 flex-shrink-0 md:absolute md:left-24 md:top-1/2 md:flex md:-translate-y-1/2'>
          <button
            onClick={() => router.push('/')}
            className='inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold tracking-[0.08em] text-[rgb(var(--ui-text))] transition hover:bg-[rgb(var(--ui-surface)/0.42)] hover:text-[rgb(var(--ui-accent))]'
          >
            <Image
              src='/logo.png'
              alt=''
              width={28}
              height={28}
              className='h-7 w-7 rounded-ui-xs object-cover'
              aria-hidden='true'
            />
            <span>{siteName}</span>
          </button>
        </div>

        <form
          role='search'
          onSubmit={handleSearch}
          className='flex min-w-0 items-center rounded-full border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-surface)/0.42)] p-1 shadow-ui-soft backdrop-blur-xl transition duration-300 focus-within:border-[rgb(var(--ui-accent)/0.44)] focus-within:bg-[rgb(var(--ui-surface-strong)/0.5)] md:absolute md:left-1/2 md:top-1/2 md:w-[min(56rem,calc(100vw-32rem))] md:-translate-x-1/2 md:-translate-y-1/2'
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
            className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] transition hover:scale-105 hover:brightness-110'
          >
            <Search size={18} />
          </button>
        </form>

        <div className='flex flex-shrink-0 items-center gap-1 sm:gap-2 md:absolute md:right-8 md:top-1/2 md:-translate-y-1/2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default TopSearchBar;
