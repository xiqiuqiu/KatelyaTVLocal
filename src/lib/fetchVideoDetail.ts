import { getAvailableApiSitesFromConfig, getConfig } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApi } from './downstream';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
  redirect?: RequestRedirect;
}

function isHttpEpisode(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Cron 已知源和 ID，只有详情无法提供播放地址时才按片名补查一页。 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
  redirect,
}: FetchVideoDetailOptions): Promise<SearchResult> {
  const config = await getConfig();
  const apiSites = getAvailableApiSitesFromConfig(config);
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }
  let detail: SearchResult | undefined;
  let detailError: unknown;
  try {
    detail = await getDetailFromApi(apiSite, id, redirect);
    if (detail?.episodes.some(isHttpEpisode)) return detail;
  } catch (error) {
    detailError = error;
  }
  if (fallbackTitle.trim()) {
    const searchData = await searchFromApi(apiSite, fallbackTitle.trim(), {
      maxSearchPages: 1,
      redirect,
    }).catch(() => []);
    const exactMatch = searchData.find(
      (item) =>
        item.source === source &&
        String(item.id) === id &&
        item.episodes.some(isHttpEpisode)
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (!detail) {
    throw detailError ?? new Error('获取视频详情失败');
  }

  return detail;
}
