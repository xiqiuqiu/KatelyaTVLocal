import {
  createPlaybackAttemptReporter,
  sanitizePlaybackEvidenceUrl,
  type PlaybackAttemptChannelDecision,
} from './index';

describe('Playback Attempt evidence reporter', () => {
  it('keeps one sessionId across source switches and remints only on title change', () => {
    const reporter = createPlaybackAttemptReporter({
      createSessionId: (() => {
        let n = 0;
        return () => `session-${++n}`;
      })(),
    });

    const started = reporter.beginAttempt({
      contentKey: 'title-a::2024',
      episodeIndex: 0,
      sourceKey: 'src-a:1',
      runtime: 'hlsjs',
    });
    expect(started.sessionId).toBe('session-1');
    expect(started.eventType).toBe('attempt.started');
    expect(started.sourceChangeAttemptId).toBeNull();

    // First real start/switch mints Source Attempt id; probes never do.
    const afterSwitch = reporter.beginSourceAttempt({
      sourceKey: 'src-b:2',
      reason: 'manual',
      episodeIndex: 0,
      runtime: 'hlsjs',
    });
    expect(afterSwitch.sessionId).toBe('session-1');
    expect(afterSwitch.sourceChangeAttemptId).toBe(1);
    expect(afterSwitch.eventType).toBe('sourceChange.started');
    expect(afterSwitch.sourceChangeAttemptIdMinted).toBe(true);

    const afterProbe = reporter.reportProbeEvent({
      eventType: 'progressive-source-probe-start',
      sourceKey: 'src-c:3',
    });
    expect(afterProbe.sessionId).toBe('session-1');
    expect(afterProbe.sourceChangeAttemptId).toBe(1);
    expect(afterProbe.sourceChangeAttemptIdMinted).toBe(false);

    const afterTitleChange = reporter.changeTitle({
      contentKey: 'title-b::2023',
      episodeIndex: 0,
      sourceKey: 'src-d:4',
      runtime: 'hlsjs',
    });
    expect(afterTitleChange.ended.sessionId).toBe('session-1');
    expect(afterTitleChange.ended.eventType).toBe('attempt.ended');
    expect(afterTitleChange.started.sessionId).toBe('session-2');
    expect(afterTitleChange.started.eventType).toBe('attempt.started');
    expect(afterTitleChange.started.sourceChangeAttemptId).toBeNull();
  });

  it('strips credentials, tokens, and signed query params from evidence URLs', () => {
    expect(
      sanitizePlaybackEvidenceUrl(
        'https://user:secret@cdn.example.com/play/abc.m3u8?token=SIGNED&expires=999&sig=abc'
      )
    ).toEqual({
      playbackUrl: 'https://cdn.example.com/play/abc.m3u8',
      playbackDomain: 'cdn.example.com',
    });

    expect(
      sanitizePlaybackEvidenceUrl(
        'https://cdn.example.com/play/abc.m3u8?auth=Bearer%20xyz&key=k'
      )
    ).toEqual({
      playbackUrl: 'https://cdn.example.com/play/abc.m3u8',
      playbackDomain: 'cdn.example.com',
    });
  });

  it('emits channel.skipped for debug-off / no-d1 without inventing a localStorage audit store', () => {
    const decisions: PlaybackAttemptChannelDecision[] = [];
    const reporter = createPlaybackAttemptReporter({
      createSessionId: () => 'session-x',
      onChannelDecision: (decision) => {
        decisions.push(decision);
      },
    });

    reporter.beginAttempt({
      contentKey: 'title-a::2024',
      episodeIndex: 0,
      sourceKey: 'src-a:1',
      runtime: 'hlsjs',
    });

    const skippedOff = reporter.resolveTransportResult({
      eventType: 'attempt.started',
      transport: {
        saved: false,
        skipped: true,
        reason: 'admin-off',
      },
    });
    expect(skippedOff).toEqual(
      expect.objectContaining({
        eventType: 'channel.skipped',
        sessionId: 'session-x',
        details: expect.objectContaining({
          channel: 'playback-debug',
          reason: 'admin-off',
          eventType: 'attempt.started',
        }),
      })
    );

    const skippedNoD1 = reporter.resolveTransportResult({
      eventType: 'recovery.stage.entered',
      transport: {
        saved: false,
        skipped: true,
        reason: 'no-d1',
      },
    });
    expect(skippedNoD1).toEqual(
      expect.objectContaining({
        eventType: 'channel.skipped',
        details: expect.objectContaining({
          channel: 'playback-debug',
          reason: 'no-d1',
        }),
      })
    );

    expect(decisions.every((d) => !d.localStorageAudit)).toBe(true);
    expect(decisions.map((d) => d.kind)).toEqual([
      'overlay',
      'transport',
      'overlay',
      'channel.skipped',
      'overlay',
      'channel.skipped',
    ]);
  });

  it('keeps channel.skipped honesty when enhanced reporting is rolled back', () => {
    const decisions: PlaybackAttemptChannelDecision[] = [];
    const reporter = createPlaybackAttemptReporter({
      createSessionId: () => 'session-rb',
      enhancedReportingEnabled: false,
      onChannelDecision: (decision) => {
        decisions.push(decision);
      },
    });

    reporter.beginAttempt({
      contentKey: 'title-a::2024',
      episodeIndex: 0,
      sourceKey: 'src-a:1',
      runtime: 'hlsjs',
    });

    const skipped = reporter.resolveTransportResult({
      eventType: 'attempt.started',
      transport: { saved: false, skipped: true, reason: 'admin-off' },
    });

    expect(skipped?.eventType).toBe('channel.skipped');
    expect(decisions.some((d) => d.kind === 'channel.skipped')).toBe(true);
    expect(decisions.every((d) => !d.localStorageAudit)).toBe(true);
  });
});
