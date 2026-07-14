export type PlaybackAttemptEndReason = 'title-change' | 'leave' | 'destroy';

export type PlaybackAttemptSkipReason =
  | 'admin-off'
  | 'no-d1'
  | 'not-admin'
  | 'network-error'
  | 'storage-unavailable'
  | 'invalid-payload'
  | 'write-failed';

export interface PlaybackAttemptDimensions {
  contentKey?: string | null;
  episodeIndex?: number | null;
  sourceKey?: string | null;
  runtime?: string | null;
}

export interface PlaybackAttemptEvent {
  sessionId: string;
  sourceChangeAttemptId: number | null;
  eventType: string;
  contentKey?: string | null;
  episodeIndex?: number | null;
  sourceKey?: string | null;
  runtime?: string | null;
  playbackUrl?: string | null;
  playbackDomain?: string | null;
  details?: Record<string, unknown>;
  /** True only when beginSourceAttempt minted a new id. */
  sourceChangeAttemptIdMinted?: boolean;
}

export interface PlaybackAttemptTransportResult {
  saved?: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface PlaybackAttemptChannelDecision {
  kind: 'overlay' | 'transport' | 'channel.skipped' | 'console';
  eventType: string;
  sessionId: string;
  /** Must stay false — no fake business localStorage audit store. */
  localStorageAudit?: false;
  reason?: string;
}

export interface CreatePlaybackAttemptReporterOptions {
  createSessionId?: () => string;
  /** Enhanced stamps / lifecycle helpers. Rollback must NOT disable skipped honesty. */
  enhancedReportingEnabled?: boolean;
  onEmit?: (event: PlaybackAttemptEvent) => void;
  onChannelDecision?: (decision: PlaybackAttemptChannelDecision) => void;
}

export interface PlaybackAttemptReporter {
  getSessionId(): string | null;
  getSourceChangeAttemptId(): number | null;
  beginAttempt(dimensions: PlaybackAttemptDimensions): PlaybackAttemptEvent;
  endAttempt(reason: PlaybackAttemptEndReason): PlaybackAttemptEvent | null;
  changeTitle(dimensions: PlaybackAttemptDimensions): {
    ended: PlaybackAttemptEvent;
    started: PlaybackAttemptEvent;
  };
  beginSourceAttempt(input: {
    sourceKey: string;
    reason: 'auto' | 'manual';
    episodeIndex?: number | null;
    runtime?: string | null;
    contentKey?: string | null;
  }): PlaybackAttemptEvent;
  reportProbeEvent(input: {
    eventType: string;
    sourceKey?: string | null;
    details?: Record<string, unknown>;
  }): PlaybackAttemptEvent;
  report(input: {
    eventType: string;
    details?: Record<string, unknown>;
    contentKey?: string | null;
    episodeIndex?: number | null;
    sourceKey?: string | null;
    runtime?: string | null;
    playbackUrl?: string | null;
  }): PlaybackAttemptEvent;
  resolveTransportResult(input: {
    eventType: string;
    transport: PlaybackAttemptTransportResult;
  }): PlaybackAttemptEvent | null;
}
