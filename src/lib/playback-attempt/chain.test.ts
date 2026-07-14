import { createPlaybackAttemptReporter } from './index';

/**
 * M5 migration acceptance: one complete Playback Attempt evidence chain
 * (Q3-leaning total chain — Intent deny → R → Source Attempt → progress save).
 */
describe('Playback Attempt end-to-end evidence chain', () => {
  it('correlates a full Q3-leaning attempt chain under one sessionId', () => {
    const emitted: Array<{
      eventType: string;
      sessionId: string;
      sourceChangeAttemptId: number | null;
      contentKey?: string | null;
      episodeIndex?: number | null;
      sourceKey?: string | null;
      runtime?: string | null;
      details?: Record<string, unknown>;
    }> = [];

    const reporter = createPlaybackAttemptReporter({
      createSessionId: () => 'attempt-chain-1',
      onEmit: (event) => {
        emitted.push({
          eventType: event.eventType,
          sessionId: event.sessionId,
          sourceChangeAttemptId: event.sourceChangeAttemptId,
          contentKey: event.contentKey,
          episodeIndex: event.episodeIndex,
          sourceKey: event.sourceKey,
          runtime: event.runtime,
          details: event.details,
        });
      },
    });

    reporter.beginAttempt({
      contentKey: '鬼泣::2024',
      episodeIndex: 0,
      sourceKey: 'ruyi:1',
      runtime: 'hlsjs',
    });

    reporter.report({
      eventType: 'intent.gate.denied',
      details: { deniedBy: 'user-paused', kind: 'same-source-recovery' },
    });

    reporter.report({
      eventType: 'recovery.stage.entered',
      details: { stage: 'R0' },
    });

    reporter.report({
      eventType: 'badPoint.remembered',
      details: { anchorTimeSeconds: 120, sourceKey: 'ruyi:1' },
    });

    reporter.beginSourceAttempt({
      sourceKey: 'ruyi:2',
      reason: 'auto',
      episodeIndex: 0,
      runtime: 'hlsjs',
    });

    reporter.report({
      eventType: 'adSkip.loaded',
      details: { windowCount: 1 },
    });

    reporter.report({
      eventType: 'adSkip.emitted',
      details: { windowKey: 'w1' },
    });

    reporter.report({
      eventType: 'adSkip.completed',
      details: { windowKey: 'w1' },
    });

    reporter.report({
      eventType: 'progressSave.requested',
      details: { reason: 'episode-ended', completed: true, episodeIndex: 0 },
      episodeIndex: 0,
    });

    reporter.report({
      eventType: 'channel.skipped',
      details: {
        channel: 'playback-debug',
        reason: 'no-d1',
        eventType: 'progressSave.requested',
      },
    });

    reporter.endAttempt('leave');

    const types = emitted.map((e) => e.eventType);
    expect(types).toEqual([
      'attempt.started',
      'intent.gate.denied',
      'recovery.stage.entered',
      'badPoint.remembered',
      'sourceChange.started',
      'adSkip.loaded',
      'adSkip.emitted',
      'adSkip.completed',
      'progressSave.requested',
      'channel.skipped',
      'attempt.ended',
    ]);

    expect(new Set(emitted.map((e) => e.sessionId))).toEqual(
      new Set(['attempt-chain-1'])
    );

    const sourceChange = emitted.find((e) => e.eventType === 'sourceChange.started');
    expect(sourceChange?.sourceChangeAttemptId).toBe(1);
    expect(sourceChange?.sourceKey).toBe('ruyi:2');

    for (const event of emitted) {
      expect(event.contentKey).toBe('鬼泣::2024');
      expect(event.runtime).toBe('hlsjs');
      expect(event).not.toHaveProperty('username');
      expect(event).not.toHaveProperty('cookie');
      expect(event).not.toHaveProperty('token');
      if (typeof event.details?.playbackUrl === 'string') {
        expect(event.details.playbackUrl).not.toMatch(/[?&](token|sig|auth|key)=/i);
      }
    }

    const progress = emitted.find((e) => e.eventType === 'progressSave.requested');
    expect(progress?.details).toEqual(
      expect.objectContaining({
        reason: 'episode-ended',
        completed: true,
        episodeIndex: 0,
      })
    );
  });
});
