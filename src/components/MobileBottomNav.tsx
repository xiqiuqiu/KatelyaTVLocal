'use client';

import { Clover, Film, Heart, Home, Search, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  type NavigationIcon,
  isNavigationItemActive,
  primaryNavigationItems,
} from '@/lib/ui/navigation';

interface MobileBottomNavProps {
  activePath?: string;
}

const iconMap: Record<NavigationIcon, typeof Home> = {
  home: Home,
  search: Search,
  film: Film,
  tv: Tv,
  clover: Clover,
  heart: Heart,
  settings: Home,
};

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();

  const currentActive = activePath ?? pathname;

  return (
    <nav
      className='ui-glass-strong fixed inset-x-0 bottom-0 z-[600] rounded-none border-x-0 border-b-0 md:hidden'
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className='absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent' />

      <ul className='flex items-center'>
        {primaryNavigationItems.map((item) => {
          const active = isNavigationItemActive(currentActive, item.href);
          const Icon = iconMap[item.icon];

          return (
            <li key={item.href} className='flex-shrink-0 w-1/5'>
              <Link
                href={item.href}
                data-active={active}
                className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
                  active ? '-translate-y-0.5' : 'hover:-translate-y-0.5'
                }`}
              >
                {active && (
                  <div className='absolute inset-x-2 inset-y-1 rounded-ui-md border border-[rgb(var(--ui-accent)/0.24)] bg-[rgb(var(--ui-surface-strong)/0.48)] shadow-ui-soft' />
                )}

                <Icon
                  className={`relative h-5 w-5 transition ${
                    active
                      ? 'scale-105 text-[rgb(var(--ui-accent))]'
                      : 'text-[rgb(var(--ui-text-muted))] hover:text-[rgb(var(--ui-text))]'
                  }`}
                />
                <span
                  className={`relative transition ${
                    active
                      ? 'text-[rgb(var(--ui-text))]'
                      : 'text-[rgb(var(--ui-text-muted))]'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
