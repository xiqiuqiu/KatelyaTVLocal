/**
 * Pure parser for Douban `subject_suggest` JSON.
 * No network — picks the first usable subject id (or null).
 */
export function parseDoubanSubjectSuggest(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (!/^\d+$/.test(id.trim())) continue;
    return id.trim();
  }

  return null;
}
