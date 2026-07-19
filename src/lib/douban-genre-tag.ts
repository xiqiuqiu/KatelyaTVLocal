/**
 * CMS genre labels that Douban `search_subjects` does not accept as TV tags.
 * Map to the nearest tag that still returns subjects (empirically verified).
 */
const GENRE_TAG_ALIASES: Record<string, string> = {
  真人秀: '综艺',
  脱口秀: '综艺',
  选秀: '综艺',
  晚会: '综艺',
  访谈: '综艺',
  相声: '综艺',
};

/**
 * Derives a Douban `search_subjects?tag=` value from Apple CMS `vod_class`.
 * Uses the first segment, then applies known aliases when Douban rejects the
 * raw CMS label (e.g. 真人秀 → 综艺).
 */
export function deriveDoubanGenreTag(
  vodClass?: string | null
): string | null {
  if (!vodClass?.trim()) return null;

  const segments = vodClass
    .split(/[,，/|、]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const raw = segments[0];
  if (!raw) return null;

  return GENRE_TAG_ALIASES[raw] ?? raw;
}
