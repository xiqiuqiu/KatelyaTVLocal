import {
  createPlaybackAttemptSessionId,
  sanitizeEvidenceDetails,
  sanitizePlaybackEvidenceUrl,
} from './sanitize';
import type {
  CreatePlaybackAttemptReporterOptions,
  PlaybackAttemptDimensions,
  PlaybackAttemptEndReason,
  PlaybackAttemptEvent,
  PlaybackAttemptReporter,
  PlaybackAttemptSkipReason,
  PlaybackAttemptTransportResult,
} from './types';

function normalizeSkipReason(reason: string | undefined): PlaybackAttemptSkipReason {
  switch (reason) {
    case 'disabled':
    case 'admin-off':
      return 'admin-off';
    case 'no-d1':
      return 'no-d1';
    case 'not-admin':
      return 'not-admin';
    case 'network-error':
      return 'network-error';
    case 'storage-unavailable':
      return 'storage-unavailable';
    case 'invalid-payload':
      return 'invalid-payload';
    case 'write-failed':
      return 'write-failed';
    default:
      return 'storage-unavailable';
  }
}

export function createPlaybackAttemptReporter(
  options: CreatePlaybackAttemptReporterOptions = {}
): PlaybackAttemptReporter {
  const createSessionId = options.createSessionId || createPlaybackAttemptSessionId;
  // Rollback may disable enhanced overlays; skipped-channel honesty stays on.
  void options.enhancedReportingEnabled;

  let sessionId: string | null = null;
  let sourceChangeAttemptId: number | null = null;
  let dimensions: PlaybackAttemptDimensions = {};

  const emit = (event: PlaybackAttemptEvent): PlaybackAttemptEvent => {
    const stamped: PlaybackAttemptEvent = {
      ...event,
      contentKey: event.contentKey ?? dimensions.contentKey ?? null,
      episodeIndex:
        event.episodeIndex ?? dimensions.episodeIndex ?? null,
      sourceKey: event.sourceKey ?? dimensions.sourceKey ?? null,
      runtime: event.runtime ?? dimensions.runtime ?? null,
      details: sanitizeEvidenceDetails(event.details),
    };

    if (stamped.playbackUrl) {
      const sanitized = sanitizePlaybackEvidenceUrl(stamped.playbackUrl);
      stamped.playbackUrl = sanitized.playbackUrl;
      stamped.playbackDomain = sanitized.playbackDomain;
    }

    options.onEmit?.(stamped);
    options.onChannelDecision?.({
      kind: 'overlay',
      eventType: stamped.eventType,
      sessionId: stamped.sessionId,
      localStorageAudit: false,
    });

    if (stamped.eventType !== 'channel.skipped') {
      options.onChannelDecision?.({
        kind: 'transport',
        eventType: stamped.eventType,
        sessionId: stamped.sessionId,
        localStorageAudit: false,
      });
    }

    return stamped;
  };

  const ensureSession = (next: PlaybackAttemptDimensions): string => {
    if (!sessionId) {
      sessionId = createSessionId();
      sourceChangeAttemptId = null;
    }
    dimensions = {
      contentKey: next.contentKey ?? dimensions.contentKey ?? null,
      episodeIndex: next.episodeIndex ?? dimensions.episodeIndex ?? null,
      sourceKey: next.sourceKey ?? dimensions.sourceKey ?? null,
      runtime: next.runtime ?? dimensions.runtime ?? null,
    };
    return sessionId;
  };

  return {
    getSessionId() {
      return sessionId;
    },

    getSourceChangeAttemptId() {
      return sourceChangeAttemptId;
    },

    beginAttempt(nextDimensions) {
      sessionId = createSessionId();
      sourceChangeAttemptId = null;
      dimensions = { ...nextDimensions };
      return emit({
        sessionId,
        sourceChangeAttemptId: null,
        eventType: 'attempt.started',
        ...dimensions,
      });
    },

    endAttempt(reason: PlaybackAttemptEndReason) {
      if (!sessionId) {
        return null;
      }
      const ended = emit({
        sessionId,
        sourceChangeAttemptId,
        eventType: 'attempt.ended',
        details: { reason },
      });
      sessionId = null;
      sourceChangeAttemptId = null;
      dimensions = {};
      return ended;
    },

    changeTitle(nextDimensions) {
      const previousSessionId = sessionId || createSessionId();
      const ended = emit({
        sessionId: previousSessionId,
        sourceChangeAttemptId,
        eventType: 'attempt.ended',
        details: { reason: 'title-change' },
      });
      sessionId = createSessionId();
      sourceChangeAttemptId = null;
      dimensions = { ...nextDimensions };
      const started = emit({
        sessionId,
        sourceChangeAttemptId: null,
        eventType: 'attempt.started',
        ...dimensions,
      });
      return { ended, started };
    },

    beginSourceAttempt(input) {
      const id = ensureSession({
        contentKey: input.contentKey,
        episodeIndex: input.episodeIndex,
        sourceKey: input.sourceKey,
        runtime: input.runtime,
      });
      sourceChangeAttemptId = (sourceChangeAttemptId || 0) + 1;
      dimensions = {
        ...dimensions,
        sourceKey: input.sourceKey,
        episodeIndex: input.episodeIndex ?? dimensions.episodeIndex,
        runtime: input.runtime ?? dimensions.runtime,
        contentKey: input.contentKey ?? dimensions.contentKey,
      };
      return emit({
        sessionId: id,
        sourceChangeAttemptId,
        sourceChangeAttemptIdMinted: true,
        eventType: 'sourceChange.started',
        sourceKey: input.sourceKey,
        episodeIndex: input.episodeIndex ?? dimensions.episodeIndex,
        runtime: input.runtime ?? dimensions.runtime,
        details: { reason: input.reason },
      });
    },

    reportProbeEvent(input) {
      const id = ensureSession({ sourceKey: input.sourceKey });
      return emit({
        sessionId: id,
        sourceChangeAttemptId,
        sourceChangeAttemptIdMinted: false,
        eventType: input.eventType,
        sourceKey: input.sourceKey ?? dimensions.sourceKey,
        details: input.details,
      });
    },

    report(input) {
      const id = ensureSession({
        contentKey: input.contentKey,
        episodeIndex: input.episodeIndex,
        sourceKey: input.sourceKey,
        runtime: input.runtime,
      });
      if (input.sourceKey) {
        dimensions = { ...dimensions, sourceKey: input.sourceKey };
      }
      if (input.episodeIndex != null) {
        dimensions = { ...dimensions, episodeIndex: input.episodeIndex };
      }
      if (input.runtime) {
        dimensions = { ...dimensions, runtime: input.runtime };
      }
      if (input.contentKey) {
        dimensions = { ...dimensions, contentKey: input.contentKey };
      }

      const eventType = input.eventType;

      return emit({
        sessionId: id,
        sourceChangeAttemptId,
        eventType,
        contentKey: input.contentKey,
        episodeIndex: input.episodeIndex,
        sourceKey: input.sourceKey,
        runtime: input.runtime,
        playbackUrl: input.playbackUrl,
        details: input.details,
      });
    },

    resolveTransportResult(input: {
      eventType: string;
      transport: PlaybackAttemptTransportResult;
    }) {
      if (!input.transport.skipped) {
        return null;
      }

      const id = sessionId || ensureSession({});
      const reason = normalizeSkipReason(input.transport.reason);
      const skipped = emit({
        sessionId: id,
        sourceChangeAttemptId,
        eventType: 'channel.skipped',
        details: {
          channel: 'playback-debug',
          reason,
          eventType: input.eventType,
        },
      });

      // Honesty path: always record skipped decision even when enhanced reporting is off.
      options.onChannelDecision?.({
        kind: 'channel.skipped',
        eventType: 'channel.skipped',
        sessionId: id,
        reason,
        localStorageAudit: false,
      });

      return skipped;
    },
  };
}

export function isPlaybackAttemptEnhancedReportingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLAYBACK_ATTEMPT_EVIDENCE !== 'false';
}
