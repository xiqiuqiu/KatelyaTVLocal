import { getSafeRedirectPath } from '@/lib/safe-redirect';

describe('getSafeRedirectPath', () => {
  it('keeps safe relative paths with query strings', () => {
    expect(getSafeRedirectPath('/play?x=1')).toBe('/play?x=1');
  });

  it('rejects absolute https URLs', () => {
    expect(getSafeRedirectPath('https://evil.com')).toBe('/');
  });

  it('rejects protocol-relative URLs', () => {
    expect(getSafeRedirectPath('//evil.com')).toBe('/');
  });

  it('rejects backslash paths', () => {
    expect(getSafeRedirectPath('/\\evil')).toBe('/');
  });

  it('falls back for empty values', () => {
    expect(getSafeRedirectPath('')).toBe('/');
    expect(getSafeRedirectPath(null)).toBe('/');
    expect(getSafeRedirectPath(undefined)).toBe('/');
  });
});
