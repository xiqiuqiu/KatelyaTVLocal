import { deriveDoubanGenreTag } from '@/lib/douban-genre-tag';

describe('deriveDoubanGenreTag', () => {
  it('returns the first genre segment from vod_class', () => {
    expect(deriveDoubanGenreTag('喜剧,爱情')).toBe('喜剧');
    expect(deriveDoubanGenreTag('悬疑 / 犯罪')).toBe('悬疑');
    expect(deriveDoubanGenreTag('科幻')).toBe('科幻');
  });

  it('returns null when no usable genre tag can be derived', () => {
    expect(deriveDoubanGenreTag('')).toBeNull();
    expect(deriveDoubanGenreTag('   ')).toBeNull();
    expect(deriveDoubanGenreTag(undefined)).toBeNull();
    expect(deriveDoubanGenreTag(',,,')).toBeNull();
  });
});
