'use client';

import { Menu, Search, Tv, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { buildTvModeHref } from '@/lib/tv-interaction';

import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';

interface TopSearchBarProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMenu?: () => void;
  menuOpen?: boolean;
  modeHref?: string;
}

const TopSearchBar = ({
  isSidebarCollapsed = false,
  onToggleSidebar,
  onOpenMenu,
  menuOpen = false,
  modeHref,
}: TopSearchBarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const [query, setQuery] = useState('');
  const currentHref = modeHref || `${pathname}?${searchParams.toString()}`;
  const canEnterTvMode = ['/', '/search', '/history'].includes(pathname);

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header
      className='ui-topbar-glass fixed inset-x-0 top-0 z-50'
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className='ui-topbar-content'>
        <div className='flex min-w-0 items-center gap-2'>
          <button
            type='button'
            onClick={onToggleSidebar}
            aria-pressed={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className='ui-icon-button hidden md:inline-flex'
          >
            <Menu aria-hidden size={20} />
          </button>
          <Link href='/' className='ui-brand'>
            <Image
              src='/logo.png'
              alt=''
              width={28}
              height={28}
              aria-hidden
              className='h-7 w-7 shrink-0 rounded-md'
            />
            <span className='truncate'>{siteName}</span>
          </Link>
        </div>
        <form
          role='search'
          aria-label='全站搜索'
          onSubmit={handleSearch}
          className='ui-topbar-search'
        >
          <input
            type='search'
            aria-label='搜索影片、电视剧、综艺'
            placeholder='搜索影片、电视剧、综艺'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='h-11 min-w-0 flex-1 rounded-ui-sm border-0 bg-transparent px-3 text-base text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted))] focus:outline-none focus:ring-0'
          />
          <button
            type='submit'
            aria-label='提交搜索'
            className='ui-icon-button bg-[rgb(var(--ui-accent))] !text-[rgb(var(--ui-on-accent))] hover:!bg-[rgb(var(--ui-accent))]'
          >
            <Search aria-hidden size={20} />
          </button>
        </form>
        <div className='flex shrink-0 items-center gap-1'>
          {canEnterTvMode && (
            <Link
              href={buildTvModeHref(currentHref, true)}
              className='ui-icon-button md:w-auto md:gap-2 md:px-3'
              aria-label='进入电视模式'
              title='进入电视模式'
            >
              <Tv aria-hidden className='h-5 w-5 shrink-0' />
              <span className='hidden text-sm lg:inline'>电视模式</span>
            </Link>
          )}
          <ThemeToggle />
          <button
            type='button'
            onClick={onOpenMenu}
            aria-label='账号菜单'
            aria-haspopup='dialog'
            aria-expanded={menuOpen}
            className='ui-icon-button hidden md:inline-flex'
          >
            <User aria-hidden className='h-5 w-5' />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TopSearchBar;
