import type { BannerVisit } from './playback-quality';

const LAUNCH_KEY = 'home-banner-launch';

export function rememberBannerClick(record: BannerVisit, href: string) {
  try {
    sessionStorage.setItem(
      LAUNCH_KEY,
      JSON.stringify({ record, href, at: Date.now() })
    );
  } catch {
    // Storage restrictions must never prevent navigation.
  }
}

export function takeBannerClick(url: URL): BannerVisit | undefined {
  try {
    const raw = sessionStorage.getItem(LAUNCH_KEY);
    sessionStorage.removeItem(LAUNCH_KEY);
    if (!raw || url.searchParams.get('from') !== 'home-banner') return;
    const { record, href, at } = JSON.parse(raw);
    const target = new URL(href, url.origin);
    if (
      Date.now() - at > 120_000 ||
      target.pathname !== url.pathname ||
      ['title', 'year', 'stype', 'playbackTest'].some(
        (key) => target.searchParams.get(key) !== url.searchParams.get(key)
      )
    )
      return;
    return record;
  } catch {
    return;
  }
}
