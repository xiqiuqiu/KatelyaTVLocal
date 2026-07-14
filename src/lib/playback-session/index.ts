export {
  getPlaybackIntentAuthorityMode,
  isPlaybackIntentSessionAuthorityEnabled,
  resolveAdapterAutomaticEffectAllowed,
  resolveAutomaticEffectGate,
} from './authority';
export type {
  PlaybackIntentAuthorityMode,
  ResolveAdapterAutomaticEffectAllowedInput,
  ResolveAutomaticEffectGateInput,
} from './authority';
export {
  allowsAutomaticEffect,
  getAutomaticEffectGate,
} from './intent';
export {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from './reducer';
export type {
  AutomaticEffectKind,
  PlaybackIntent,
  PlaybackIntentGateResult,
  PlaybackSessionEffect,
  PlaybackSessionEvent,
  PlaybackSessionResult,
  PlaybackSessionSourceScore,
  PlaybackSessionState,
  VideoSnapshot,
} from './types';
