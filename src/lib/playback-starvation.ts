/**
 * "Fed too slowly" is not a hard stall. The playhead may still creep, which
 * resets the waiting timer, while forward buffer never rebuilds. This tracker
 * turns that pattern into one immediate source-switch signal.
 *
 * Hard stalls, fatal HLS errors, and startup timeouts stay on the R ladder.
 */

/** Forward buffer at or below this counts as an empty runway. */
export const STARVATION_RUNWAY_SECONDS = 2;
/**
 * Runway must stay empty this long before a switch. One buffer dip during a
 * seek or a quality change is not enough.
 */
export const STARVATION_SUSTAIN_MS = 6000;
/** Rebuffers inside one window. A single waiting blip does not switch. */
export const STARVATION_REBUFFER_THRESHOLD = 3;
export const STARVATION_REBUFFER_WINDOW_MS = 20000;
/** Ignore sub-notice waits so ad-skip and gap nudges are not rebuffers. */
export const STARVATION_MIN_REBUFFER_MS = 400;

export interface StarvationSampleInput {
  nowMs: number;
  currentTime: number;
  playbackRate?: number;
  /** Seconds of media buffered ahead of the playhead. */
  forwardBufferSeconds: number;
  paused?: boolean;
  seeking?: boolean;
  ended?: boolean;
}

export interface PlaybackStarvationState {
  runwayStarvingSinceMs: number | null;
  rebufferStartedAtMs: number | null;
  rebufferStartedAtTime: number | null;
  playbackRate: number | null;
  rebufferTimesMs: number[];
}

export function createPlaybackStarvationState(): PlaybackStarvationState {
  return {
    runwayStarvingSinceMs: null,
    rebufferStartedAtMs: null,
    rebufferStartedAtTime: null,
    playbackRate: null,
    rebufferTimesMs: [],
  };
}

export interface StarvationSampleResult {
  state: PlaybackStarvationState;
  /** Current source cannot keep realtime playback; switch immediately. */
  starved: boolean;
}

function countRecentRebuffers(
  timesMs: number[],
  nowMs: number
): { timesMs: number[]; count: number } {
  const recent = timesMs.filter(
    (time) => nowMs - time <= STARVATION_REBUFFER_WINDOW_MS
  );
  return { timesMs: recent, count: recent.length };
}

export function samplePlaybackStarvation(
  state: PlaybackStarvationState,
  input: StarvationSampleInput
): StarvationSampleResult {
  const playbackRate = input.playbackRate ?? 1;
  if (input.paused || input.seeking || input.ended || playbackRate <= 0) {
    return {
      state: createPlaybackStarvationState(),
      starved: false,
    };
  }
  if (state.playbackRate != null && state.playbackRate !== playbackRate) {
    state = createPlaybackStarvationState();
  }

  const recent = countRecentRebuffers(state.rebufferTimesMs, input.nowMs);
  let rebufferTimesMs = recent.timesMs;
  let rebufferStartedAtMs = state.rebufferStartedAtMs;
  let rebufferStartedAtTime = state.rebufferStartedAtTime;
  // Low buffer alone is healthy if the playhead keeps up at the chosen speed.
  const rebufferDelayMs =
    rebufferStartedAtMs != null && rebufferStartedAtTime != null
      ? input.nowMs -
        rebufferStartedAtMs -
        ((input.currentTime - rebufferStartedAtTime) / playbackRate) * 1000
      : 0;
  const hasRebuffered =
    Math.round(rebufferDelayMs) >= STARVATION_MIN_REBUFFER_MS;

  if (input.forwardBufferSeconds <= STARVATION_RUNWAY_SECONDS) {
    if (rebufferStartedAtMs == null) {
      rebufferStartedAtMs = input.nowMs;
      rebufferStartedAtTime = input.currentTime;
    }
  } else if (rebufferStartedAtMs != null) {
    if (hasRebuffered) {
      rebufferTimesMs = [...rebufferTimesMs, rebufferStartedAtMs];
    }
    rebufferStartedAtMs = null;
    rebufferStartedAtTime = null;
  }

  const runwayStarvingSinceMs =
    input.forwardBufferSeconds <= STARVATION_RUNWAY_SECONDS
      ? state.runwayStarvingSinceMs ?? input.nowMs
      : null;
  const runwayStarved =
    runwayStarvingSinceMs != null &&
    input.nowMs - runwayStarvingSinceMs >= STARVATION_SUSTAIN_MS &&
    hasRebuffered;
  const rebufferStarved =
    countRecentRebuffers(rebufferTimesMs, input.nowMs).count >=
    STARVATION_REBUFFER_THRESHOLD;

  return {
    state: {
      runwayStarvingSinceMs,
      rebufferStartedAtMs,
      rebufferStartedAtTime,
      playbackRate,
      rebufferTimesMs,
    },
    starved: runwayStarved || rebufferStarved,
  };
}

/** Continuous playable buffer from the playhead, without crossing a gap. */
export function getForwardBufferSeconds(
  currentTime: number,
  ranges: Array<{ start: number; end: number }>
): number {
  const range = ranges.find(
    ({ start, end }) => start <= currentTime && currentTime < end
  );
  return range ? range.end - currentTime : 0;
}
