import type { PlaybackSessionEffect, SameSourceRecoverAction } from './types';

export interface ApplySameSourceRecoverHandlers {
  nudgePlayback: (targetTime: number | null) => void;
  restartLoad: () => void;
  recoverMedia: () => void;
  resumePlayback: (targetTime: number | null) => void;
  escapeBadPoint: (targetTime: number) => void;
}

/** Thin adapter: map Session sameSourceRecover action → runtime handlers. */
export function applySameSourceRecoverAction(
  action: SameSourceRecoverAction,
  targetTime: number | null,
  handlers: ApplySameSourceRecoverHandlers
): void {
  switch (action) {
    case 'nudge-playback':
      handlers.nudgePlayback(targetTime);
      return;
    case 'restart-load':
      handlers.restartLoad();
      return;
    case 'recover-media':
      handlers.recoverMedia();
      return;
    case 'resume-playback':
      handlers.resumePlayback(targetTime);
      return;
    case 'escape-bad-point':
      if (targetTime != null) {
        handlers.escapeBadPoint(targetTime);
      }
      return;
  }
}

export interface PlaybackSessionEffectSink {
  onSwitchSource: (
    effect: Extract<PlaybackSessionEffect, { type: 'switchSource' }>
  ) => void;
  onSameSourceRecover: (
    effect: Extract<PlaybackSessionEffect, { type: 'sameSourceRecover' }>
  ) => void;
  onApplyRecoveryResume: (
    effect: Extract<PlaybackSessionEffect, { type: 'applyRecoveryResume' }>
  ) => void;
  onSkipAdWindow?: (
    effect: Extract<PlaybackSessionEffect, { type: 'skipAdWindow' }>
  ) => void;
  onShowAdSkipUndo?: (
    effect: Extract<PlaybackSessionEffect, { type: 'showAdSkipUndo' }>
  ) => void;
  onRestoreAdSkipWindow?: (
    effect: Extract<PlaybackSessionEffect, { type: 'restoreAdSkipWindow' }>
  ) => void;
  onCancelAdSkip?: (
    effect: Extract<PlaybackSessionEffect, { type: 'cancelAdSkip' }>
  ) => void;
  onEmitDebugEvent?: (
    effect: Extract<PlaybackSessionEffect, { type: 'emitDebugEvent' }>
  ) => void;
}

/** Thin adapter: execute Session effects without re-deciding recovery policy. */
export function executePlaybackSessionEffects(
  effects: readonly PlaybackSessionEffect[],
  sink: PlaybackSessionEffectSink
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'switchSource':
        sink.onSwitchSource(effect);
        break;
      case 'sameSourceRecover':
        sink.onSameSourceRecover(effect);
        break;
      case 'applyRecoveryResume':
        sink.onApplyRecoveryResume(effect);
        break;
      case 'skipAdWindow':
        sink.onSkipAdWindow?.(effect);
        break;
      case 'showAdSkipUndo':
        sink.onShowAdSkipUndo?.(effect);
        break;
      case 'restoreAdSkipWindow':
        sink.onRestoreAdSkipWindow?.(effect);
        break;
      case 'cancelAdSkip':
        sink.onCancelAdSkip?.(effect);
        break;
      case 'emitDebugEvent':
        sink.onEmitDebugEvent?.(effect);
        break;
      default:
        break;
    }
  }
}
