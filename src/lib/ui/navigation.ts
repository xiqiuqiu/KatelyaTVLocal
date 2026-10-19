export type NavigationIcon =
  | 'home'
  | 'search'
  | 'film'
  | 'tv'
  | 'clover'
  | 'heart'
  | 'compass'
  | 'history';

export interface NavigationItem {
  href: string;
  icon: NavigationIcon;
  key: string;
  label: string;
}

export const primaryNavigationItems: readonly NavigationItem[] = [
  { key: 'home', label: '首页', href: '/', icon: 'home' },
  { key: 'discover', label: '发现', href: '/douban', icon: 'compass' },
  { key: 'search', label: '搜索', href: '/search', icon: 'search' },
] as const;

export const catalogNavigationItems: readonly NavigationItem[] = [
  { key: 'movie', label: '电影', href: '/douban?type=movie', icon: 'film' },
  { key: 'tv', label: '剧集', href: '/douban?type=tv', icon: 'tv' },
  { key: 'show', label: '综艺', href: '/douban?type=show', icon: 'clover' },
] as const;

export const sidebarNavigationItems: readonly NavigationItem[] = [
  primaryNavigationItems[0],
  primaryNavigationItems[1],
  { key: 'favorites', label: '收藏夹', href: '/?tab=favorites', icon: 'heart' },
  { key: 'history', label: '播放历史', href: '/history', icon: 'history' },
] as const;

export function isNavigationItemActive(activePath: string, href: string) {
  const current = new URL(activePath, 'https://tv.local');
  const target = new URL(href, 'https://tv.local');
  if (current.pathname !== target.pathname) return false;
  if (
    target.pathname === '/' &&
    current.searchParams.get('tab') !== target.searchParams.get('tab')
  )
    return false;
  return Array.from(target.searchParams).every(
    ([key, value]) => key === 'tv' || current.searchParams.get(key) === value
  );
}
