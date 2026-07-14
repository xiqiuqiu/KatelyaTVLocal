import type {
  AutomaticEffectKind,
  PlaybackIntentGateResult,
  PlaybackSessionState,
} from './types';

export function allowsAutomaticEffect(
  state: PlaybackSessionState,
  kind: AutomaticEffectKind,
  nowMs: number
): boolean {
  return getAutomaticEffectGate(state, kind, nowMs).allowed;
}

export function getAutomaticEffectGate(
  state: PlaybackSessionState,
  kind: AutomaticEffectKind,
  nowMs: number
): PlaybackIntentGateResult {
  if (state.playbackIntent === 'user-paused') {
    return { allowed: false, deniedBy: 'user-paused' };
  }

  if (state.playbackIntent === 'seeking') {
    return { allowed: false, deniedBy: 'seeking' };
  }

  if (
    state.sourceSwitchSettledUntilMs != null &&
    nowMs < state.sourceSwitchSettledUntilMs
  ) {
    return { allowed: false, deniedBy: 'source-switch-settle' };
  }

  if (state.playbackIntent === 'seek-settled' && state.seekSettledAtMs != null) {
    const elapsed = nowMs - state.seekSettledAtMs;
    if (elapsed < 0) {
      return { allowed: false, deniedBy: 'seek-settled' };
    }

    if (kind === 'auto-source-switch') {
      if (elapsed < state.seekSettledLongGuardMs) {
        return { allowed: false, deniedBy: 'seek-settled' };
      }
      return { allowed: true };
    }

    if (elapsed < state.seekSettledShortGuardMs) {
      return { allowed: false, deniedBy: 'seek-settled' };
    }
  }

  return { allowed: true };
}
