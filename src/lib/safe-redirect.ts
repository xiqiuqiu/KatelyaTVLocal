/**
 * Allow only same-app relative paths. Reject protocol-relative and absolute URLs.
 */
export function getSafeRedirectPath(
  raw: string | null | undefined,
  fallback = '/'
): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('://')) return fallback;
  if (value.includes('\\')) return fallback;
  return value;
}
