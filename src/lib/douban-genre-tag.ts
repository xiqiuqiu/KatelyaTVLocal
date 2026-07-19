/**
 * Derives a Douban `search_subjects?tag=` value from Apple CMS `vod_class`.
 * Straightforward first-segment mapping — refine when relevance gaps show up.
 */
export function deriveDoubanGenreTag(
  vodClass?: string | null
): string | null {
  if (!vodClass?.trim()) return null;

  const segments = vodClass
    .split(/[,，/|、]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments[0] ?? null;
}
