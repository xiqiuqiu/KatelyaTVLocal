import { savePlaybackFeedback } from '@/lib/source-ranking/feedback';

describe('source ranking feedback', () => {
  it('persists playback feedback rows for d1 aggregation', async () => {
    const run = jest.fn().mockResolvedValue({ success: true });
    const bind = jest.fn().mockReturnValue({ run });
    const prepare = jest.fn().mockReturnValue({ bind });

    const saved = await savePlaybackFeedback(
      { DB: { prepare } },
      {
        sourceKey: 'mdzy',
        platform: 'apple-hlsjs',
        playbackDomain: 'play.modujx13.com',
        title: '庆余年',
        playbackMode: 'proxy',
        startupSuccess: true,
        startupTimeMs: 820,
        switchedToProxy: true,
        browserQuality: '1080p',
        browserPingMs: 180,
        browserSpeedLabel: '2.3 MB/s',
      },
      1710000000000
    );

    expect(saved).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO playback_feedback_events')
    );
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'mdzy',
      'apple-hlsjs',
      'play.modujx13.com',
      '庆余年',
      'proxy',
      1,
      820,
      1,
      '1080p',
      180,
      '2.3 MB/s',
      null,
      1710000000000
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns false when d1 binding is unavailable', async () => {
    await expect(
      savePlaybackFeedback(
        {},
        {
          sourceKey: 'mdzy',
          playbackMode: 'direct',
          startupSuccess: true,
        }
      )
    ).resolves.toBe(false);
  });
});
