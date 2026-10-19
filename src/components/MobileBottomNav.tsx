'use client';

import { Compass, Home, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  isNavigationItemActive,
  primaryNavigationItems,
} from '@/lib/ui/navigation';

interface MobileBottomNavProps {
  activePath?: string;
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

const icons: Record<string, typeof Home> = {
  home: Home,
  discover: Compass,
  search: Search,
};

export default function MobileBottomNav({
  activePath,
  onOpenMenu,
  menuOpen = false,
}: MobileBottomNavProps) {
  const pathname = usePathname();
  const currentActive = activePath ?? pathname;
  const personalActive =
    isNavigationItemActive(currentActive, '/?tab=favorites') ||
    ['/history', '/admin'].includes(pathname);
  const itemClass =
    'flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-ui-sm text-xs font-medium text-[rgb(var(--ui-text-muted))] transition-colors data-[active=true]:text-[rgb(var(--ui-accent))]';

  return (
    <nav aria-label='手机导航' className='ui-mobile-nav md:hidden'>
      <ul className='grid grid-cols-4 px-2'>
        {primaryNavigationItems.map((item) => {
          const Icon = icons[item.key];
          const active = isNavigationItemActive(currentActive, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-active={active && !menuOpen}
                aria-current={active ? 'page' : undefined}
                className={itemClass}
              >
                <Icon aria-hidden className='h-5 w-5' />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type='button'
            onClick={onOpenMenu}
            aria-haspopup='dialog'
            aria-expanded={menuOpen}
            data-active={personalActive || menuOpen}
            className={itemClass}
          >
            <User aria-hidden className='h-5 w-5' />
            <span>我的</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
