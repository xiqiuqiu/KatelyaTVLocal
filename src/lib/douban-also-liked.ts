import type { DoubanItem } from '@/lib/types';

/**
 * Pure parser for Douban subject-page 「喜欢这部的人也喜欢」.
 * No network — scrapes the `recommendations-bd` block into DoubanItem[].
 */
export function parseDoubanAlsoLiked(html: string): DoubanItem[] {
  const blockMatch = html.match(
    /<div class="recommendations-bd">([\s\S]*?)<\/div>/
  );
  if (!blockMatch) return [];

  const block = blockMatch[1];
  const dlPattern = /<dl>([\s\S]*?)<\/dl>/g;
  const items: DoubanItem[] = [];
  let dlMatch: RegExpExecArray | null;

  while ((dlMatch = dlPattern.exec(block)) !== null) {
    const dl = dlMatch[1];
    const idMatch = dl.match(
      /href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\//
    );
    const imgMatch = dl.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const altMatch = dl.match(/<img[^>]+alt="([^"]*)"[^>]*>/i);
    const titleLinkMatch = dl.match(
      /<dd>[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/\d+\/[^"]*"[^>]*>([^<]*)<\/a>/i
    );
    const rateMatch = dl.match(
      /<span class="subject-rate"[^>]*>([^<]*)<\/span>/
    );

    const id = idMatch?.[1];
    const poster = (imgMatch?.[1] || '').replace(/^http:/, 'https:');
    const title = (altMatch?.[1] || titleLinkMatch?.[1] || '').trim();
    const rate = (rateMatch?.[1] || '').trim();

    if (!id || !title || !poster) continue;

    items.push({
      id,
      title,
      poster,
      rate,
      year: '',
    });
  }

  return items;
}
