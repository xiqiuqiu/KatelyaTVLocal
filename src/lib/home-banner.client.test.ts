import { rememberBannerClick, takeBannerClick } from './home-banner.client';

const record = {
  rowKind: 'banner',
  sessionId: 'test-visit',
  startedAt: 1,
  seq: 2,
  testSession: true,
} as const;
const href = '/play?title=A&year=2020&from=home-banner&playbackTest=1';

it('attributes only the clicked title and cohort, once', () => {
  for (const other of [
    href.replace('title=A', 'title=B'),
    href.replace('playbackTest=1', ''),
    href.replace('home-banner', 'playrecord'),
  ]) {
    rememberBannerClick(record, href);
    expect(takeBannerClick(new URL(other, location.origin))).toBeUndefined();
  }
  rememberBannerClick(record, href);
  const url = new URL(href, location.origin);
  expect(takeBannerClick(url)).toEqual(record);
  expect(takeBannerClick(url)).toBeUndefined();
});
