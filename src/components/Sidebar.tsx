'use client';

import {
  Clover,
  Compass,
  Film,
  Heart,
  History,
  Home,
  Menu,
  Search,
  Settings,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import {
  type NavigationIcon,
  type NavigationItem,
  isNavigationItemActive,
  sidebarNavigationItems,
} from '@/lib/ui/navigation';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: true,
});

export const useSidebar = () => useContext(SidebarContext);

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
  visible?: boolean;
  collapsed?: boolean;
  showCollapseToggle?: boolean;
  onOpenMenu?: () => void;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const iconMap: Record<NavigationIcon, typeof Home> = {
  home: Home,
  search: Search,
  film: Film,
  tv: Tv,
  clover: Clover,
  heart: Heart,
  compass: Compass,
  history: History,
};

const Sidebar = ({
  onToggle,
  activePath = '/',
  visible = true,
  collapsed,
  showCollapseToggle = true,
  onOpenMenu,
}: SidebarProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isControlled = typeof collapsed === 'boolean';
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const isCollapsed = isControlled ? collapsed : localCollapsed;

  // 首次挂载时读取 localStorage，以便刷新后仍保持上次的折叠状态
  useLayoutEffect(() => {
    if (isControlled) return;

    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setLocalCollapsed(val);
      window.__sidebarCollapsed = val;
    }
  }, [isControlled]);

  // 当折叠状态变化时，同步到 <html> data 属性，供首屏 CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    if (activePath) {
      setActive(activePath);
    } else {
      const getCurrentFullPath = () => {
        const queryString = searchParams.toString();
        return queryString ? `${pathname}?${queryString}` : pathname;
      };
      const fullPath = getCurrentFullPath();
      setActive(fullPath);
    }
  }, [activePath, pathname, searchParams]);

  useEffect(() => {
    onToggle?.(isCollapsed);
  }, [isCollapsed, onToggle]);

  const handleToggle = () => {
    const newState = !isCollapsed;
    if (!isControlled) {
      setLocalCollapsed(newState);
    }
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  };

  const contextValue = useMemo(() => ({ isCollapsed }), [isCollapsed]);

  const renderNavItem = (item: NavigationItem) => {
    const Icon = iconMap[item.icon];
    const isActive = isNavigationItemActive(active, item.href);

    return (
      <Link
        key={item.key}
        aria-label={item.label}
        href={item.href}
        onClick={() => setActive(item.href)}
        data-active={isActive}
        aria-current={isActive ? 'page' : undefined}
        title={isCollapsed ? item.label : undefined}
        className={`ui-nav-item ${isCollapsed ? 'justify-center' : ''}`}
      >
        <span className='flex h-5 w-5 items-center justify-center'>
          <Icon className='h-5 w-5' />
        </span>
        <span
          className={`truncate overflow-hidden transition-[max-width,opacity] duration-200 ease-out ${
            isCollapsed
              ? 'pointer-events-none max-w-0 opacity-0'
              : 'max-w-[9rem] opacity-100'
          }`}
        >
          {item.label}
        </span>
      </Link>
    );
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          data-testid='desktop-sidebar'
          data-collapsed={isCollapsed}
          className={`fixed inset-y-0 left-0 z-40 flex h-dvh flex-col border-r border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-bg))] pt-[calc(4rem+env(safe-area-inset-top))] transition-[transform,opacity] duration-motionBase ease-easeOutStrong ${
            isCollapsed ? 'w-20' : 'w-44'
          } ${
            visible
              ? 'translate-x-0 opacity-100'
              : '-translate-x-full opacity-0'
          }`}
        >
          <div className='flex h-full flex-col px-3 pb-6'>
            <div
              className={`relative flex ${
                showCollapseToggle ? 'h-16' : 'h-6'
              } items-center`}
            >
              {showCollapseToggle && (
                <button
                  onClick={handleToggle}
                  aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  className={`absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-surface)/0.42)] text-[rgb(var(--ui-text-muted))] shadow-ui-soft transition-[left,transform,border-color,background-color,color] duration-300 ease-easeOutStrong hover:border-[rgb(var(--ui-accent)/0.36)] hover:bg-[rgb(var(--ui-surface-strong)/0.52)] hover:text-[rgb(var(--ui-text))] ${
                    isCollapsed ? 'left-1/2 -translate-x-1/2' : 'left-3'
                  }`}
                >
                  <Menu className='h-4 w-4' />
                </button>
              )}
            </div>

            <nav aria-label='主导航' className='space-y-2'>
              {sidebarNavigationItems.map(renderNavItem)}
            </nav>
            <button
              type='button'
              onClick={onOpenMenu}
              aria-label='设置'
              aria-haspopup='dialog'
              title={isCollapsed ? '设置' : undefined}
              className={`ui-nav-item mt-auto w-full ${
                isCollapsed ? 'justify-center' : ''
              }`}
            >
              <Settings aria-hidden className='h-5 w-5 shrink-0' />
              {!isCollapsed && <span>设置</span>}
            </button>
          </div>
        </aside>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
