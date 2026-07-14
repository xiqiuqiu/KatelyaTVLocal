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

export interface PlaybackIntentGateResult {
  allowed: boolean;
  deniedBy?:
    | 'user-paused'
    | 'seeking'
    | 'seek-settled'
    | 'source-switch-settle';
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

export interface PlaybackSessionState {
  sources: SearchResult[];
  currentSourceKey: string | null;
  currentEpisodeIndex: number;
  sourceStatuses: Map<string, SourceStatus>;
  sourceScores: Map<string, PlaybackSessionSourceScore>;
  measuredVideoInfo: Map<string, SourceVideoInfo>;
  recoveredSourceKeys: Set<string>;
  badPoints: PlaybackBadPoint[];
  adSkipWindows: HlsAdSkipWindow[];
  lastAdSkipWindowKey: string | null;
  adSkipInFlightWindowKey: string | null;
  pendingResumeTime: number | null;
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
  | { type: 'adSkipWindows.loaded'; windows: HlsAdSkipWindow[] }
  | { type: 'progressSave.requested'; reason: PlayRecordSaveReason }
  | { type: 'sourceChange.started'; attemptId: number; sourceKey: string }
  | { type: 'sourceChange.completed'; attemptId: number; sourceKey: string }
  | { type: 'recovery.switchFailed'; sourceKey: string }
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
      type: 'skipAdWindow';
      targetTime: number;
      windowKey: string;
      reason: 'hls-ad-window';
      platform: 'apple-native' | 'hlsjs';
    }
  | {
      type: 'cancelAdSkip';
      windowKey: string;
      reason: 'user-paused' | 'seeking' | 'user-switch';
    }
  | {
      type: 'saveProgress';
      reason: PlayRecordSaveReason;
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
