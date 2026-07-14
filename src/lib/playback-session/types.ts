import type { HlsAdSkipWindow } from '@/lib/hls-ad-skip';
import type { PlayRecordSaveReason } from '@/lib/play-record-save-policy';
import type { PlaybackBadPoint } from '@/lib/playback-stuck-escape';
import type { SearchResult, SourceStatus, SourceVideoInfo } from '@/lib/types';

export type PlaybackIntent =
  | 'playing'
  | 'user-paused'
  | 'seeking'
  | 'seek-settled';

export type AutomaticEffectKind =
  | 'ad-skip'
  | 'same-source-recovery'
  | 'auto-source-switch';

export type PlaybackRecoveryStage =
  | 'idle'
  | 'R0'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'exhausted';

export type RecoveryInFlightKind = 'R1' | 'R2' | 'R3' | 'resume' | null;

export type SameSourceRecoverAction =
  | 'nudge-playback'
  | 'restart-load'
  | 'recover-media'
  | 'resume-playback'
  | 'escape-bad-point';

export interface PlaybackIntentGateResult {
  allowed: boolean;
  deniedBy?:
    | 'user-paused'
    | 'seeking'
    | 'seek-settled'
    | 'source-switch-settle'
    | 'recovery-in-flight'
    | 'resume-pending';
}

export interface VideoSnapshot {
  currentTime: number;
  duration?: number | null;
  readyState?: number | null;
  networkState?: number | null;
  paused?: boolean | null;
  ended?: boolean | null;
  playbackUrl?: string | null;
}

export interface PlaybackSessionSourceScore {
  score: number;
}

export interface BadPointScope {
  contentKey: string;
  episodeIndex: number;
}

/** Adapter-only media/runtime summaries — never carry private escalation plans. */
export interface RecoveryRuntimeEvidence {
  platform: 'apple-native' | 'hlsjs';
  stallCandidate?: boolean;
  /** Hard failure may shorten R0/R1; still requires Intent for R3. */
  hardFailure?: boolean;
  hls?: {
    stallCount: number;
    fatal?: boolean;
    errorType?: string | null;
  };
  native?: {
    severity: 'observe' | 'soft-stall' | 'hard-stall' | 'source-failed';
    isJitter: boolean;
    jitterWindowCount: number;
  };
}

export interface PlaybackSessionState {
  sources: SearchResult[];
  currentSourceKey: string | null;
  currentEpisodeIndex: number;
  contentKey: string | null;
  sourceStatuses: Map<string, SourceStatus>;
  sourceScores: Map<string, PlaybackSessionSourceScore>;
  measuredVideoInfo: Map<string, SourceVideoInfo>;
  recoveredSourceKeys: Set<string>;
  /** Bad points visible for the active Bad Point Scope only. */
  badPoints: PlaybackBadPoint[];
  /** Scoped storage: `${contentKey}::${episodeIndex}` → points. */
  badPointsByScope: Map<string, PlaybackBadPoint[]>;
  adSkipWindows: HlsAdSkipWindow[];
  lastAdSkipWindowKey: string | null;
  adSkipInFlightWindowKey: string | null;
  /** Recovery Resume Time — sole Session authority for planned playhead. */
  recoveryResumeTime: number | null;
  /** @deprecated Alias of recoveryResumeTime during M3 migration. */
  pendingResumeTime: number | null;
  recoveryStage: PlaybackRecoveryStage;
  stallEpisodeActive: boolean;
  r0EnteredAtMs: number | null;
  r1AttemptCount: number;
  r2AttemptCount: number;
  recoveryInFlight: RecoveryInFlightKind;
  playbackIntent: PlaybackIntent;
  resumeIntentAfterSeek: 'playing' | 'user-paused' | null;
  lastUserSeekAtMs: number | null;
  seekSettledAtMs: number | null;
  seekSettledShortGuardMs: number;
  seekSettledLongGuardMs: number;
  sourceChangeInFlight: boolean;
  currentSourceChangeAttemptId: number;
  sourceChangeSourceKey: string | null;
  sourceSwitchSettledUntilMs: number | null;
  manualSeekGraceMs: number;
}

export type PlaybackSessionEvent =
  | {
      type: 'sources.loaded';
      sources: SearchResult[];
      currentSourceKey: string | null;
      currentEpisodeIndex: number;
      contentKey?: string | null;
      sourceStatuses?: Map<string, SourceStatus>;
      sourceScores?: Map<string, PlaybackSessionSourceScore>;
      measuredVideoInfo?: Map<string, SourceVideoInfo>;
      recoveredSourceKeys?: Set<string>;
    }
  | { type: 'user.play' }
  | { type: 'user.pause' }
  | { type: 'user.seekStarted'; nowMs: number }
  | { type: 'user.seekSettled'; nowMs: number }
  | {
      type: 'user.switchSource';
      sourceKey: string;
      nowMs: number;
    }
  | {
      type: 'user.switchEpisode';
      episodeIndex: number;
      nowMs: number;
    }
  | {
      type: 'video.ended';
      nextEpisodeIndex: number;
      nowMs: number;
    }
  | { type: 'adSkipWindows.loaded'; windows: HlsAdSkipWindow[] }
  | { type: 'progressSave.requested'; reason: PlayRecordSaveReason }
  | { type: 'sourceChange.started'; attemptId: number; sourceKey: string }
  | { type: 'sourceChange.completed'; attemptId: number; sourceKey: string }
  | { type: 'recovery.switchFailed'; sourceKey: string }
  | {
      type: 'recovery.runtimeEvidence';
      snapshot: VideoSnapshot;
      nowMs: number;
      evidence: RecoveryRuntimeEvidence;
    }
  | {
      type: 'recovery.progressHealthy';
      snapshot: VideoSnapshot;
      nowMs: number;
    }
  | { type: 'recovery.cancel' }
  | {
      type: 'recovery.effectSettled';
      kind: 'R1' | 'R2' | 'resume';
      nowMs: number;
    }
  | { type: 'video.waiting'; snapshot: VideoSnapshot; nowMs: number }
  | {
      type: 'video.timeupdate';
      snapshot: VideoSnapshot;
      nowMs: number;
      platform?: 'apple-native' | 'hlsjs';
    }
  | { type: 'video.stalled'; snapshot: VideoSnapshot; nowMs: number }
  | {
      type: 'video.error';
      snapshot: VideoSnapshot;
      nowMs: number;
      errorCode?: number;
    }
  | {
      type: 'timer.sourceChangeTimeout';
      attemptId: number;
      sourceKey: string;
      snapshot: VideoSnapshot;
      nowMs: number;
    };

export type PlaybackSessionEffect =
  | {
      type: 'switchSource';
      sourceKey: string;
      source: SearchResult;
      episodeIndex: number;
      resumeTime: number | null;
      reason: 'auto-recovery' | 'source-timeout';
    }
  | {
      type: 'sameSourceRecover';
      stage: 'R1' | 'R2';
      action: SameSourceRecoverAction;
      targetTime: number | null;
      reason: string;
    }
  | {
      type: 'applyRecoveryResume';
      resumeTime: number;
    }
  | {
      type: 'skipAdWindow';
      targetTime: number;
      windowKey: string;
      reason: 'hls-ad-window';
      platform: 'apple-native' | 'hlsjs';
    }
  | {
      type: 'cancelAdSkip';
      windowKey: string;
      reason:
        | 'user-paused'
        | 'seeking'
        | 'user-switch'
        | 'recovery-in-flight'
        | 'resume-pending';
    }
  | {
      type: 'saveProgress';
      reason: PlayRecordSaveReason;
      /** Episode to seal when saving before an advance; omit = current. */
      episodeIndex?: number;
      /** Ended→next completion semantics for the sealed episode. */
      completed?: boolean;
    }
  | {
      type: 'emitDebugEvent';
      eventType: string;
      message: string;
      details?: Record<string, unknown>;
    };

export interface PlaybackSessionResult {
  state: PlaybackSessionState;
  effects: PlaybackSessionEffect[];
}
