export type NavigationIcon =
  | 'home'
  | 'search'
  | 'film'
  | 'tv'
  | 'clover'
  | 'heart'
  | 'settings';

export interface NavigationItem {
  href: string;
  icon: NavigationIcon;
  key: string;
  label: string;
}

export const primaryNavigationItems: readonly NavigationItem[] = [
  { key: 'home', label: '首页', href: '/', icon: 'home' },
  { key: 'search', label: '搜索', href: '/search', icon: 'search' },
  { key: 'movie', label: '电影', href: '/douban?type=movie', icon: 'film' },
  { key: 'tv', label: '剧集', href: '/douban?type=tv', icon: 'tv' },
  { key: 'show', label: '综艺', href: '/douban?type=show', icon: 'clover' },
] as const;

export const sidebarNavigationItems: readonly NavigationItem[] = [
  ...primaryNavigationItems,
  { key: 'favorites', label: '收藏夹', href: '/?tab=favorites', icon: 'heart' },
] as const;

export const secondaryNavigationItems: readonly NavigationItem[] = [
  {
    key: 'config',
    label: 'TVBox配置',
    href: '/config',
    icon: 'settings',
  },
] as const;

export function isNavigationItemActive(activePath: string, href: string) {
  const decodedActive = decodeURIComponent(activePath);
  const decodedHref = decodeURIComponent(href);

  if (decodedActive === decodedHref) {
    return true;
  }

  const [hrefPath, hrefQuery = ''] = decodedHref.split('?');
  if (hrefPath !== '/douban' || !decodedActive.startsWith('/douban')) {
    return false;
  }

  const hrefParams = new URLSearchParams(hrefQuery);
  const type = hrefParams.get('type');
  const tag = hrefParams.get('tag');

  if (!type || !decodedActive.includes(`type=${type}`)) {
    return false;
  }

  return tag ? decodedActive.includes(`tag=${tag}`) : true;
}
