/**
 * TMDB 代理白名单。
 *
 * 只放行我们真正会用到的端点，避免这个代理变成「谁都能拿来查 TMDB」的开放网关
 * （那样会烧掉配额，也不符合 TMDB 的使用条款）。
 */
const ALLOWED_PATTERNS: RegExp[] = [
  /^search\/(movie|tv|multi)$/,
  /^movie\/\d+$/,
  /^tv\/\d+$/,
  /^movie\/\d+\/recommendations$/,
  /^tv\/\d+\/recommendations$/,
  /^movie\/\d+\/credits$/,
  /^tv\/\d+\/credits$/,
  /^tv\/\d+\/season\/\d+$/,
  /^trending\/(movie|tv|all)\/(day|week)$/,
  /^discover\/(movie|tv)$/,
  /^genre\/(movie|tv)\/list$/,
];

/** 允许透传给 TMDB 的查询参数，其余一律丢弃。 */
const ALLOWED_PARAMS = new Set([
  'query',
  'year',
  'primary_release_year',
  'first_air_date_year',
  'language',
  'page',
  'include_adult',
  'with_genres',
  'sort_by',
  'vote_average.gte',
  'vote_count.gte',
  'primary_release_date.gte',
  'primary_release_date.lte',
  'first_air_date.gte',
  'first_air_date.lte',
  'with_original_language',
  'with_origin_country',
  'with_keywords',
  'without_keywords',
  'with_runtime.lte',
  'region',
  'append_to_response',
]);

export function isAllowedTmdbPath(path: string): boolean {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return false;
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * 过滤查询参数。`vote_average.gte` 这类带点的键会被 URLSearchParams 原样传递，
 * 但 TMDB 需要 `vote_average.gte`，所以这里保留点号。
 */
export function sanitizeTmdbParams(search: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  search.forEach((value, key) => {
    if (!ALLOWED_PARAMS.has(key)) return;
    params.set(key, value);
  });
  return params;
}
