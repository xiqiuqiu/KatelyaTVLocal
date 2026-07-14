import { getAutomaticEffectGate } from './intent';
import type {
  AutomaticEffectKind,
  PlaybackIntentGateResult,
  PlaybackSessionState,
} from './types';

export type PlaybackIntentAuthorityMode = 'session' | 'legacy';

export function isPlaybackIntentSessionAuthorityEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY !== 'false';
}

export function getPlaybackIntentAuthorityMode(): PlaybackIntentAuthorityMode {
  return isPlaybackIntentSessionAuthorityEnabled() ? 'session' : 'legacy';
}

export interface ResolveAutomaticEffectGateInput {
  kind: AutomaticEffectKind;
  nowMs: number;
  sessionState: PlaybackSessionState;
  legacyAllowed: boolean;
  legacyDeniedBy?: PlaybackIntentGateResult['deniedBy'];
}

/**
 * Single decision entry for adapters. Session and legacy are mutually exclusive —
 * never AND/OR both authorities in one call.
 */
export function resolveAutomaticEffectGate(
  input: ResolveAutomaticEffectGateInput
): PlaybackIntentGateResult {
  if (getPlaybackIntentAuthorityMode() === 'session') {
    return getAutomaticEffectGate(input.sessionState, input.kind, input.nowMs);
  }

  if (input.legacyAllowed) {
    return { allowed: true };
  }

  return {
    allowed: false,
    deniedBy: input.legacyDeniedBy || 'user-paused',
  };
}

export interface ResolveAdapterAutomaticEffectAllowedInput {
  kind: AutomaticEffectKind;
  nowMs: number;
  sessionState: PlaybackSessionState;
  legacyIsUserPaused: boolean;
  legacyDeniedBy?: PlaybackIntentGateResult['deniedBy'];
}

/** Thin adapter mapping: legacy pause boolean ↔ exclusive Intent gate. */
export function resolveAdapterAutomaticEffectAllowed(
  input: ResolveAdapterAutomaticEffectAllowedInput
): boolean {
  return resolveAutomaticEffectGate({
    kind: input.kind,
    nowMs: input.nowMs,
    sessionState: input.sessionState,
    legacyAllowed: !input.legacyIsUserPaused,
    legacyDeniedBy: input.legacyDeniedBy || 'user-paused',
  }).allowed;
}
