/**
 * 二级标签：TMDB keyword。
 *
 * 实测覆盖率（动画类目）：
 *   异世界 isekai     国漫 19 / 日漫 190
 *   热血 shounen      国漫  6 / 日漫 543
 *   少女 shoujo       国漫  1 / 日漫 189
 *   竞技 sports       国漫  6 / 日漫 145
 *   治愈 slice of life 国漫 31 / 日漫 760
 *
 * 国漫覆盖太薄，所以界面上会按「当前条件下有没有结果」动态隐藏标签。
 */
export interface AnimeTagOption {
  key: string;
  label: string;
  keywordId: number;
}

/** TMDB genre id 16 = Animation，电影与剧集通用。 */
export const ANIMATION_GENRE_ID = 16;

export const ANIME_TAGS: AnimeTagOption[] = [
  { key: 'isekai', label: '异世界', keywordId: 237451 },
  { key: 'shounen', label: '热血', keywordId: 207826 },
  { key: 'shoujo', label: '少女', keywordId: 206437 },
  { key: 'sports', label: '竞技', keywordId: 6075 },
  { key: 'slice-of-life', label: '治愈', keywordId: 9914 },
];

export function resolveAnimeKeywordId(tag: string | null): number | null {
  if (!tag) return null;
  return ANIME_TAGS.find((option) => option.key === tag)?.keywordId ?? null;
}

/** 只有选了「动画」类型才展示动漫二级标签。 */
export function shouldShowAnimeTags(genres: number[]): boolean {
  return genres.includes(ANIMATION_GENRE_ID);
}
