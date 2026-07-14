import {
  listPlaybackDebugLogs,
  savePlaybackDebugLog,
} from '@/lib/playback-debug/logs';

function createMockD1() {
  const run = jest.fn().mockResolvedValue({ success: true });
  const all = jest.fn().mockResolvedValue({ results: [] });
  const bind = jest.fn(() => ({ run, all }));
  const prepare = jest.fn(() => ({ bind }));

  return {
    db: { prepare },
    prepare,
    bind,
    run,
    all,
  };
}

describe('playback debug logs', () => {
  it('stores a sanitized playback debug event in D1', async () => {
    const mock = createMockD1();

    const saved = await savePlaybackDebugLog(
      { DB: mock.db },
      {
        sessionId: 'session-1',
        eventType: 'native-stall',
        sourceKey: 'ruyi:38961',
        sourceChangeAttemptId: 3,
        contentKey: '鬼泣::2024',
        episodeIndex: 1,
        playbackUrl:
          'https://user:secret@cdn.example.com/video.m3u8?token=SIGNED&expires=999',
        title: '鬼泣',
        runtime: 'native-hls',
        playlistFilter: 'proxy-observe',
        segmentMode: 'direct',
        recoveryProfile: 'native-video',
        currentTime: 438.2,
        details: {
          action: 'reload-source',
          token: 'should-strip',
          username: 'alice',
        },
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ExtraFingerprintMaterial',
      }
    );

    expect(saved).toBe(true);
    expect(mock.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO playback_debug_logs')
    );
    expect(mock.bind).toHaveBeenCalledWith(
      expect.any(String),
      'session-1',
      'native-stall',
      'ruyi:38961',
      'https://cdn.example.com/video.m3u8',
      'cdn.example.com',
      '鬼泣',
      'native-hls',
      'proxy-observe',
      'direct',
      'native-video',
      438.2,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify({
        action: 'reload-source',
        sourceChangeAttemptId: 3,
        contentKey: '鬼泣::2024',
        episodeIndex: 1,
      }),
      expect.stringMatching(/^Mozilla\/5\.0 \(iPad/),
      expect.any(Number)
    );
    const boundArgs = mock.bind.mock.calls[0] as unknown as unknown[];
    const boundUa = String(boundArgs[18] ?? '');
    expect(boundUa.length).toBeLessThanOrEqual(80);
    expect(mock.run).toHaveBeenCalled();
  });

  it('returns latest debug logs with parsed details', async () => {
    const mock = createMockD1();
    mock.all.mockResolvedValue({
      results: [
        {
          id: 'log-1',
          session_id: 'session-1',
          event_type: 'native-stall',
          source_key: 'ruyi:38961',
          playback_url: 'https://example.com/video.m3u8',
          playback_domain: 'example.com',
          title: '鬼泣',
          runtime: 'native-hls',
          playlist_filter: 'proxy-observe',
          segment_mode: 'direct',
          recovery_profile: 'native-video',
          current_time: 438.2,
          duration: 1200,
          ready_state: 2,
          network_state: 2,
          paused: 0,
          ended: 0,
          details_json: '{"action":"reload-source"}',
          user_agent: 'iPad Chrome',
          created_at: 1780066860058,
        },
      ],
    });

    const logs = await listPlaybackDebugLogs({ DB: mock.db }, 10);

    expect(mock.prepare).toHaveBeenCalledWith(
      expect.stringContaining('FROM playback_debug_logs')
    );
    expect(mock.bind).toHaveBeenCalledWith(10);
    expect(logs).toEqual([
      expect.objectContaining({
        id: 'log-1',
        sessionId: 'session-1',
        eventType: 'native-stall',
        playbackDomain: 'example.com',
        details: { action: 'reload-source' },
        createdAt: 1780066860058,
      }),
    ]);
  });
});
