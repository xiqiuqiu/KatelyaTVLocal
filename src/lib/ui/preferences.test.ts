import {
  playbackPreferences,
  readBooleanPreference,
  writeBooleanPreference,
} from '@/lib/ui/preferences';

describe('user preferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('falls back to the definition default when nothing is stored', () => {
    expect(readBooleanPreference(playbackPreferences[0])).toBe(true);
    expect(readBooleanPreference(playbackPreferences[1])).toBe(true);
  });

  it('round-trips a boolean preference', () => {
    writeBooleanPreference(playbackPreferences[0], false);
    expect(window.localStorage.getItem('defaultAggregateSearch')).toBe('false');
    expect(readBooleanPreference(playbackPreferences[0])).toBe(false);
  });

  it('ignores malformed stored values', () => {
    window.localStorage.setItem(playbackPreferences[1].storageKey, 'not-json');
    expect(readBooleanPreference(playbackPreferences[1])).toBe(true);
  });
});
