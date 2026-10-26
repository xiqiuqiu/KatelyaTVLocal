// Bump when source responses change shape so cached episode URLs are not reused.
export const SOURCE_DATA_VERSION = '2';

export function normalizeSourceQuery(query: string): string {
  return query.trim().replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
}

export function buildSourceSearchUrl(query: string): string {
  return `/api/search?q=${encodeURIComponent(
    normalizeSourceQuery(query)
  )}&v=${SOURCE_DATA_VERSION}`;
}
