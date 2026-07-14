import {
  getWatchProgressAuthorityMode,
  isWatchProgressContentKeyAuthorityEnabled,
} from './authority';

describe('Watch Progress authority façade (instant rollback)', () => {
  const original = process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY = original;
    }
  });

  it('defaults to content-key authority when the flag is unset', () => {
    delete process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY;
    expect(isWatchProgressContentKeyAuthorityEnabled()).toBe(true);
    expect(getWatchProgressAuthorityMode()).toBe('content-key');
  });

  it('rolls back to legacy source+id reads/writes when the flag is false', () => {
    process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY = 'false';
    expect(isWatchProgressContentKeyAuthorityEnabled()).toBe(false);
    expect(getWatchProgressAuthorityMode()).toBe('legacy');
  });
});
