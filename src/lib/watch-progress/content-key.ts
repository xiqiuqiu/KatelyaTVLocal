export interface WatchProgressContentKeyInput {
  title?: string | null;
  year?: string | null;
}

const MISSING_YEAR_SENTINEL = 'unknown';

function normalizeTitle(title?: string | null): string {
  return title?.trim().toLowerCase().replace(/\s+/g, '') || '';
}

function normalizeYear(year?: string | null): string {
  const trimmed = year?.trim() || '';
  if (!trimmed || trimmed.toLowerCase() === MISSING_YEAR_SENTINEL) {
    return MISSING_YEAR_SENTINEL;
  }

  if (!/^\d{4}$/.test(trimmed)) {
    return MISSING_YEAR_SENTINEL;
  }

  return trimmed;
}

/**
 * Stable Watch Progress content identity: normalized title + year.
 * Missing / invalid year always downgrades to the same sentinel.
 */
export function buildWatchProgressContentKey(
  input: WatchProgressContentKeyInput
): string {
  const title = normalizeTitle(input.title);
  const year = normalizeYear(input.year);
  return `${title}::${year}`;
}
