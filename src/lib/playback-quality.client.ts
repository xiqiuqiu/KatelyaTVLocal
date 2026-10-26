import type { PlaybackQualityRecord } from './playback-quality';

type Outcome = NonNullable<PlaybackQualityRecord['outcome']>;
type Clock = { start: number; last: number; active: number };
type Sample = { record: PlaybackQualityRecord; clock: Clock };
type StartInput = Pick<
  PlaybackQualityRecord,
  'sessionId' | 'contentKey' | 'episodeIndex' | 'platform'
> & { pageStartedAt: number; clickedAt?: number | null };

const duration = (value: number) =>
  Math.min(86_400_000, Math.max(0, Math.round(value)));

let documentNavigationConsumed = false;

/** Survives play-page unmounts; a SPA return must not reuse this document's old clock. */
export function consumePlaybackPageEntryTime(
  navigation: Pick<PerformanceEntry, 'name' | 'startTime'> | undefined,
  entryAt: number,
  href: string,
  clickedAt: number | null
): number {
  if (documentNavigationConsumed) return entryAt;
  documentNavigationConsumed = true;
  if (!navigation || clickedAt !== null) return entryAt;
  try {
    return new URL(navigation.name).pathname === new URL(href).pathname
      ? navigation.startTime
      : entryAt;
  } catch {
    return entryAt;
  }
}

/** Observes startup only. It never chooses a source, seeks, or starts playback. */
export function createPlaybackQualityReporter(
  options: { now?: () => number; fetcher?: typeof fetch } = {}
) {
  const now = options.now || (() => performance.now());
  const pending = new Map<string, PlaybackQualityRecord>();
  let input: StartInput | null = null;
  let round: Sample | null = null;
  let source: Sample | null = null;
  let roundId = 0;
  let rootRoundId = 0;
  let rootEntryKind: PlaybackQualityRecord['entryKind'] = 'direct';
  let rootPageStartedAt = 0;
  let rootClickedAt: number | null = null;
  let rootHadHidden = false;
  let rootAutoplayBlocked = false;
  let hidden = false;
  let paused = false;
  let blocked = false;
  let checkpoints = 0;
  let inFlight = false;
  let disabled = false;
  let retryAfter = 0;

  const keyOf = (record: PlaybackQualityRecord) =>
    `${record.sessionId}/${record.roundId}/${record.rowKind}/${record.attemptId}`;

  const flush = async (keepalive = false): Promise<void> => {
    if (disabled || now() < retryAfter || (inFlight && !keepalive)) return;
    const records = Array.from(pending.values()).slice(0, 4);
    if (records.length === 0) return;
    inFlight = true;
    let saved = false;
    try {
      const response = await (options.fetcher || fetch)(
        '/api/playback-quality',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schemaVersion: 1, records }),
          keepalive,
        }
      );
      if (response.status === 202 || response.status === 401) {
        disabled = true;
        pending.clear();
      } else if (response.status === 429) {
        retryAfter = now() + 60_000;
      } else if (response.ok) {
        saved = true;
        for (const record of records) {
          if (pending.get(keyOf(record))?.seq === record.seq) {
            pending.delete(keyOf(record));
          }
        }
      }
    } catch {
      // Keep the latest snapshots for the next observed event; never block video.
    } finally {
      inFlight = false;
      if (saved && pending.size > 0) void flush(keepalive);
    }
  };

  const tick = () => {
    const time = now();
    for (const sample of [round, source]) {
      if (!sample || sample.record.status !== 'pending') continue;
      if (!hidden && !paused && !blocked) {
        sample.clock.active += Math.max(0, time - sample.clock.last);
      }
      sample.clock.last = time;
    }
  };

  const publish = (sample: Sample, keepalive = false, send = true) => {
    const elapsed = duration(now() - sample.clock.start);
    sample.record = {
      ...sample.record,
      seq: sample.record.seq + 1,
      elapsedMs: elapsed,
      activeWaitMs: Math.min(elapsed, duration(sample.clock.active)),
    };
    pending.set(keyOf(sample.record), { ...sample.record });
    // shortcut: offline snapshots are bounded in memory; add durable delivery only if loss warrants it.
    if (pending.size > 64) pending.delete(pending.keys().next().value);
    if (send) void flush(keepalive);
  };

  const finishSample = (
    sample: Sample | null,
    outcome: Outcome,
    send = true
  ) => {
    if (!sample || sample.record.status !== 'pending') return;
    sample.record.status = 'terminal';
    sample.record.outcome = outcome;
    publish(sample, false, send);
  };

  const startRound = (
    reason: PlaybackQualityRecord['roundReason'],
    episodeIndex: number,
    newRoot = false
  ) => {
    if (!input || roundId >= 100) return;
    tick();
    finishSample(source, 'cancelled');
    finishSample(round, 'user-intervened');
    roundId += 1;
    if (roundId === 1 || newRoot) {
      rootRoundId = roundId;
      rootEntryKind =
        reason === 'episode'
          ? 'episode'
          : input.clickedAt != null
          ? 'click'
          : 'direct';
      rootPageStartedAt = reason === 'episode' ? now() : input.pageStartedAt;
      rootClickedAt = reason === 'episode' ? null : input.clickedAt ?? null;
      rootHadHidden = hidden;
      rootAutoplayBlocked = false;
    }
    source = null;
    paused = false;
    blocked = false;
    checkpoints = 0;
    const time = now();
    const start =
      reason === 'initial' ? input.clickedAt ?? input.pageStartedAt : time;
    round = {
      clock: { start, last: time, active: Math.max(0, time - start) },
      record: {
        sessionId: input.sessionId,
        roundId,
        rootRoundId,
        rowKind: 'round',
        attemptId: 0,
        seq: 0,
        status: 'pending',
        outcome: null,
        contentKey: input.contentKey,
        episodeIndex,
        sourceKey: null,
        platform: input.platform,
        runtime: 'hlsjs',
        entryKind: rootEntryKind,
        roundReason: reason,
        sourceReason: null,
        releaseId: process.env.NEXT_PUBLIC_PLAYBACK_RELEASE_ID || 'unknown',
        policyVersion: 'startup-direct-first-v1',
        elapsedMs: 0,
        activeWaitMs: 0,
        clickToFrameMs: null,
        pageToFrameMs: null,
        sourceToFrameMs: null,
        frameEvidence: null,
        hadHidden: rootHadHidden,
        autoplayBlocked: rootAutoplayBlocked,
        promptChoice: null,
        nextRoundId: null,
      },
    };
    publish(round);
  };

  return {
    start(next: StartInput) {
      this.finish('abandoned');
      input = { ...next, contentKey: next.contentKey?.slice(0, 512) || null };
      roundId = 0;
      rootRoundId = 0;
      round = null;
      source = null;
      startRound('initial', next.episodeIndex);
    },
    isPending: () => round?.record.status === 'pending',
    canRetry: () => Boolean(round && round.record.outcome !== 'frame-ready'),
    startRound,
    beginSource(attempt: {
      attemptId: number;
      sourceKey: string;
      episodeIndex: number;
      contentKey: string;
      reason: 'initial' | 'auto' | 'manual';
    }) {
      if (
        !round ||
        round.record.status !== 'pending' ||
        attempt.attemptId > 1000
      )
        return;
      if (source?.record.attemptId === attempt.attemptId) return;
      tick();
      finishSample(source, 'cancelled');
      const time = now();
      round.record.contentKey = attempt.contentKey.slice(0, 512);
      round.record.episodeIndex = attempt.episodeIndex;
      source = {
        clock: { start: time, last: time, active: 0 },
        record: {
          ...round.record,
          rowKind: 'source',
          attemptId: attempt.attemptId,
          sourceKey: attempt.sourceKey.slice(0, 512),
          sourceReason:
            !source &&
            attempt.reason !== 'auto' &&
            (round.record.roundReason === 'initial' ||
              round.record.roundReason === 'episode')
              ? 'initial'
              : attempt.reason,
          status: 'pending',
          outcome: null,
          seq: 0,
          elapsedMs: 0,
          activeWaitMs: 0,
        },
      };
      publish(source);
    },
    sourceFailed(
      outcome: 'source-timeout' | 'network-error' | 'media-error' | 'failed'
    ) {
      tick();
      finishSample(source, outcome);
    },
    frame(attemptId: number, evidence: 'rvfc' | 'playhead') {
      if (
        hidden ||
        paused ||
        blocked ||
        !input ||
        round?.record.status !== 'pending' ||
        source?.record.status !== 'pending' ||
        source.record.attemptId !== attemptId
      )
        return;
      tick();
      const time = now();
      for (const sample of [round, source]) {
        sample.record.sourceKey = source.record.sourceKey;
        sample.record.frameEvidence = evidence;
        sample.record.clickToFrameMs =
          rootClickedAt == null ? null : duration(time - rootClickedAt);
        sample.record.pageToFrameMs = duration(time - rootPageStartedAt);
        sample.record.sourceToFrameMs = duration(time - source.clock.start);
        finishSample(sample, 'frame-ready');
      }
    },
    setPaused(value: boolean) {
      tick();
      paused = value;
      if (!value) blocked = false;
    },
    autoplayBlocked() {
      tick();
      blocked = true;
      rootAutoplayBlocked = true;
      if (round?.record.status === 'pending')
        round.record.autoplayBlocked = true;
      if (source?.record.status === 'pending')
        source.record.autoplayBlocked = true;
    },
    setHidden(value: boolean) {
      tick();
      hidden = value;
      if (value) {
        rootHadHidden = true;
        for (const sample of [round, source]) {
          if (sample?.record.status === 'pending')
            sample.record.hadHidden = true;
        }
        if (round?.record.status === 'pending' && checkpoints < 4) {
          checkpoints += 1;
          publish(round, true);
        }
      } else {
        void flush();
      }
    },
    finish(outcome: Exclude<Outcome, 'frame-ready'> = 'abandoned') {
      tick();
      finishSample(
        source,
        outcome === 'abandoned' ? 'cancelled' : outcome,
        false
      );
      finishSample(round, outcome, false);
      void flush(true);
    },
    flush,
  };
}

/** A fresh observer is bound to one actual HLS/media generation. */
export function observePlaybackFirstFrame(
  video: HTMLVideoElement,
  options: {
    isCurrent: () => boolean;
    isReady: () => boolean;
    onFrame: (evidence: 'rvfc' | 'playhead') => void;
    onPaused: (paused: boolean) => void;
  }
): () => void {
  let disposed = false;
  let playing = false;
  let seeking = false;
  let baseline = video.currentTime;
  let callbackId: number | null = null;
  const ready = () =>
    !disposed &&
    options.isCurrent() &&
    options.isReady() &&
    playing &&
    !seeking &&
    !video.paused &&
    !video.seeking &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const complete = (evidence: 'rvfc' | 'playhead') => {
    options.onFrame(evidence);
    cleanup();
  };
  const requestFrame = () => {
    if (disposed || callbackId !== null || !video.requestVideoFrameCallback)
      return;
    callbackId = video.requestVideoFrameCallback(() => {
      callbackId = null;
      if (ready()) complete('rvfc');
      else if (!disposed && options.isCurrent()) requestFrame();
    });
  };
  const onPlaying = () => {
    if (disposed || !options.isCurrent()) return;
    playing = true;
    baseline = video.currentTime;
    options.onPaused(false);
    requestFrame();
  };
  const onPause = () => {
    if (options.isCurrent() && options.isReady()) options.onPaused(true);
  };
  const onCanplay = () => {
    queueMicrotask(() => {
      // Native autoplay may await a gesture without returning a play() promise.
      if (
        !disposed &&
        options.isCurrent() &&
        options.isReady() &&
        video.paused
      ) {
        options.onPaused(true);
      }
    });
  };
  const onSeeking = () => {
    seeking = true;
  };
  const onSeeked = () => {
    seeking = false;
    baseline = video.currentTime;
  };
  const onTimeupdate = () => {
    if (!video.requestVideoFrameCallback && ready()) {
      const delta = video.currentTime - baseline;
      if (delta > 0.01) complete('playhead');
    }
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (callbackId !== null) video.cancelVideoFrameCallback?.(callbackId);
    callbackId = null;
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('canplay', onCanplay);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('seeking', onSeeking);
    video.removeEventListener('timeupdate', onTimeupdate);
  };
  video.addEventListener('playing', onPlaying);
  video.addEventListener('pause', onPause);
  video.addEventListener('canplay', onCanplay);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('timeupdate', onTimeupdate);
  return cleanup;
}
