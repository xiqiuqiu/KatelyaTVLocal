import type { DoubanItem } from '@/lib/types';

/**
 * Pure parser for Douban mobile rexxar 「recommendations」 JSON.
 * No network — maps list entries into DoubanItem[].
 *
 * Preferred over subject-page HTML: movie.douban.com subject pages return a
 * JS challenge shell to server-side fetchers, so `recommendations-bd` never
 * appears. The rexxar endpoint stays JSON-accessible (same path categories use).
 */
export function parseDoubanRexxarRecommendations(
  payload: unknown
): DoubanItem[] {
  if (!Array.isArray(payload)) return [];

  const items: DoubanItem[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;

    const raw = entry as {
      id?: unknown;
      title?: unknown;
      pic?: { normal?: unknown; large?: unknown };
      rating?: { value?: unknown };
      card_subtitle?: unknown;
    };

    const id =
      typeof raw.id === 'string' || typeof raw.id === 'number'
        ? String(raw.id).trim()
        : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const posterRaw =
      (typeof raw.pic?.normal === 'string' && raw.pic.normal) ||
      (typeof raw.pic?.large === 'string' && raw.pic.large) ||
      '';
    const poster = posterRaw.replace(/^http:/, 'https:');

    if (!id || !/^\d+$/.test(id) || !title || !poster) continue;

    const rateValue = raw.rating?.value;
    const rate =
      typeof rateValue === 'number' && Number.isFinite(rateValue)
        ? rateValue.toFixed(1)
        : typeof rateValue === 'string'
          ? rateValue.trim()
          : '';

    const yearMatch =
      typeof raw.card_subtitle === 'string'
        ? raw.card_subtitle.match(/(\d{4})/)
        : null;

    items.push({
      id,
      title,
      poster,
      rate,
      year: yearMatch?.[1] || '',
    });
  }

  return items;
}

/**
 * Pure parser for Douban subject-page 「喜欢这部的人也喜欢」.
 * No network — scrapes the `recommendations-bd` block into DoubanItem[].
 * Kept for fixture/regression coverage; live fetch uses rexxar (see above).
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
