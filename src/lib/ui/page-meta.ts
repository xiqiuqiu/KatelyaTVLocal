import { primaryNavigationItems } from '@/lib/ui/navigation';

export interface PageMetaEntry {
  subtitle: string;
  title: string;
}

export const pageMeta = {
  '/': {
    title: primaryNavigationItems[0].label,
    subtitle: '聚合首页与继续观看入口',
  },
  '/search': {
    title: primaryNavigationItems[1].label,
    subtitle: '按片名、演员或年份检索内容',
  },
  '/douban?type=movie': {
    title: primaryNavigationItems[2].label,
    subtitle: '豆瓣热门电影',
  },
  '/douban?type=tv': {
    title: primaryNavigationItems[3].label,
    subtitle: '豆瓣热门剧集',
  },
  '/douban?type=show': {
    title: primaryNavigationItems[4].label,
    subtitle: '豆瓣热门综艺',
  },
  '/config': {
    title: 'TVBox配置',
    subtitle: '配置 TVBox 数据源',
  },
  '/play': {
    title: '播放',
    subtitle: '视频详情与播放控制',
  },
} as const satisfies Record<string, PageMetaEntry>;

export const homeTabMeta = {
  favorites: {
    title: '收藏夹',
    subtitle: '集中查看已保存的内容并快速回到追更进度',
  },
  home: pageMeta['/'],
} as const;

export const pageSectionLabels = {
  continueWatching: '继续观看',
  doubanCatalog: '精选片单',
  doubanFilters: '筛选内容',
  favoriteItems: '我的收藏',
  popularMovies: '热门电影',
  popularShows: '热门剧集',
  popularVariety: '热门综艺',
  searchResults: '搜索结果',
  searchHistory: '搜索历史',
  viewMore: '查看更多',
} as const;

export function getDoubanPageMeta(type: string) {
  switch (type) {
    case 'tv':
      return pageMeta['/douban?type=tv'];
    case 'show':
      return pageMeta['/douban?type=show'];
    case 'movie':
    default:
      return pageMeta['/douban?type=movie'];
  }
}
