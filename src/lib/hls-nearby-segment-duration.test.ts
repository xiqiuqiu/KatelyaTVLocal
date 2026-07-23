import { getNearbyHlsSegmentDurationSeconds } from '@/lib/hls-nearby-segment-duration';

describe('getNearbyHlsSegmentDurationSeconds', () => {
  it('returns the fragment duration covering the playhead', () => {
    const duration = getNearbyHlsSegmentDurationSeconds(
      {
        currentLevel: 0,
        levels: [
          {
            details: {
              fragments: [
                { start: 0, duration: 4 },
                { start: 4, duration: 6 },
                { start: 10, duration: 5 },
              ],
            },
          },
        ],
      },
      7.2
    );

    expect(duration).toBe(6);
  });

  it('falls back to targetduration when fragments are unavailable', () => {
    const duration = getNearbyHlsSegmentDurationSeconds(
      {
        currentLevel: 0,
        levels: [{ details: { targetduration: 8 } }],
      },
      12
    );

    expect(duration).toBe(8);
  });

  it('returns null when playlist details are missing', () => {
    expect(
      getNearbyHlsSegmentDurationSeconds({ levels: [{}], currentLevel: 0 }, 3)
    ).toBeNull();
    expect(getNearbyHlsSegmentDurationSeconds(null, 3)).toBeNull();
  });
});
