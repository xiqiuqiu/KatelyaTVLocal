'use client';

import {
  Clover,
  Film,
  Heart,
  Home,
  Menu,
  Search,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

import {
  type NavigationIcon,
  type NavigationItem,
  isNavigationItemActive,
  secondaryNavigationItems,
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
};

const Sidebar = ({
  onToggle,
  activePath = '/',
  visible = true,
  collapsed,
  showCollapseToggle = true,
}: SidebarProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isControlled = typeof collapsed === 'boolean';
  const [localCollapsed, setLocalCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return true; // 默认使用设计图中的紧凑图标栏
  });
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

  const contextValue = {
    isCollapsed,
  };

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
        title={isCollapsed ? item.label : undefined}
        className={`group flex items-center gap-3 rounded-ui-md px-4 py-3 text-sm transition ${
          isCollapsed ? 'justify-center px-3' : ''
        } text-[rgb(var(--ui-text-muted))] hover:-translate-y-0.5 hover:bg-[rgb(var(--ui-surface)/0.42)] hover:text-[rgb(var(--ui-text))] data-[active=true]:border data-[active=true]:border-[rgb(var(--ui-accent)/0.24)] data-[active=true]:bg-[rgb(var(--ui-surface-strong)/0.5)] data-[active=true]:text-[rgb(var(--ui-text))] data-[active=true]:shadow-ui-soft`}
      >
        <span className='flex h-5 w-5 items-center justify-center'>
          <Icon className='h-4 w-4' />
        </span>
        {!isCollapsed && <span className='truncate'>{item.label}</span>}
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
          className={`ui-glass-strong fixed inset-y-0 left-0 z-40 flex h-screen flex-col rounded-none border-y-0 border-l-0 pt-[calc(4rem+env(safe-area-inset-top))] transition-all duration-300 ${
            isCollapsed ? 'w-20' : 'w-64'
          } ${
            visible
              ? 'translate-x-0 opacity-100'
              : '-translate-x-full opacity-0'
          }`}
        >
          <div className='flex h-full flex-col px-3 pb-6'>
            <div className='relative flex h-16 items-center'>
              {showCollapseToggle && (
                <button
                  onClick={handleToggle}
                  aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  className={`absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-surface)/0.42)] text-[rgb(var(--ui-text-muted))] shadow-ui-soft transition hover:border-[rgb(var(--ui-accent)/0.36)] hover:bg-[rgb(var(--ui-surface-strong)/0.52)] hover:text-[rgb(var(--ui-text))] ${
                    isCollapsed ? 'left-1/2 -translate-x-1/2' : 'left-3'
                  }`}
                >
                  <Menu className='h-4 w-4' />
                </button>
              )}
            </div>

            <nav className='mt-4 space-y-2'>
              {sidebarNavigationItems.slice(0, 2).map(renderNavItem)}
            </nav>

            <div className='mt-6 flex-1 overflow-y-auto'>
              <div className='space-y-2'>
                {sidebarNavigationItems.slice(2).map(renderNavItem)}
              </div>
              <div className='mt-6 space-y-2 border-t border-white/10 pt-6'>
                {secondaryNavigationItems.map(renderNavItem)}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
