import type { PlaybackSessionEffect } from '@/lib/playback-session';
import { resolveNativeJitterRouting } from '@/lib/playback-session';
import {
  applySameSourceRecoverAction,
  executePlaybackSessionEffects,
} from '@/lib/playback-session/adapter-effects';

describe('Playback Session recovery adapter mapping', () => {
  const originalFlag =
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY =
        originalFlag;
    }
  });

  it('maps sameSourceRecover actions without inventing escalation', () => {
    const calls: string[] = [];
    applySameSourceRecoverAction('escape-bad-point', 120, {
      nudgePlayback: () => calls.push('nudge'),
      restartLoad: () => calls.push('restart'),
      recoverMedia: () => calls.push('recover'),
      resumePlayback: () => calls.push('resume'),
      escapeBadPoint: (t) => calls.push(`escape:${t}`),
    });
    expect(calls).toEqual(['escape:120']);
  });

  it('routes Session effects to sink handlers only', () => {
    const seen: string[] = [];
    const effects: PlaybackSessionEffect[] = [
      {
        type: 'applyRecoveryResume',
        resumeTime: 42,
      },
      {
        type: 'sameSourceRecover',
        stage: 'R1',
        action: 'nudge-playback',
        targetTime: 10,
        reason: 'test',
      },
      {
        type: 'showAdSkipUndo',
        windowKey: 'rule-1:10.000-20.000',
        restoreTimeSeconds: 10,
        dismissAfterMs: 5000,
      },
      {
        type: 'restoreAdSkipWindow',
        targetTime: 10,
        windowKey: 'rule-1:10.000-20.000',
      },
    ];

    executePlaybackSessionEffects(effects, {
      onSwitchSource: () => seen.push('switch'),
      onSameSourceRecover: (effect) => seen.push(effect.action),
      onApplyRecoveryResume: (effect) =>
        seen.push(`resume:${effect.resumeTime}`),
      onShowAdSkipUndo: (effect) =>
        seen.push(`undo-toast:${effect.windowKey}`),
      onRestoreAdSkipWindow: (effect) =>
        seen.push(`restore:${effect.targetTime}`),
    });

    expect(seen).toEqual([
      'resume:42',
      'nudge-playback',
      'undo-toast:rule-1:10.000-20.000',
      'restore:10',
    ]);
  });

  it('maps Native jitter routing from the paired recovery authority flag', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'true';
    expect(resolveNativeJitterRouting()).toBe('session-tree');

    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'false';
    expect(resolveNativeJitterRouting()).toBe('legacy-parallel');
  });
});
