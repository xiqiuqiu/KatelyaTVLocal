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
  /** Seconds of media buffered ahead of the playhead. */
  forwardBufferSeconds: number;
  paused?: boolean;
  seeking?: boolean;
  ended?: boolean;
}

export interface PlaybackStarvationState {
  runwayStarvingSinceMs: number | null;
  rebufferStartedAtMs: number | null;
  rebufferTimesMs: number[];
}

export function createPlaybackStarvationState(): PlaybackStarvationState {
  return {
    runwayStarvingSinceMs: null,
    rebufferStartedAtMs: null,
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
  if (input.paused || input.seeking || input.ended) {
    return {
      state: {
        ...state,
        runwayStarvingSinceMs: null,
        rebufferStartedAtMs: null,
      },
      starved: false,
    };
  }

  const recent = countRecentRebuffers(state.rebufferTimesMs, input.nowMs);
  let rebufferTimesMs = recent.timesMs;
  let rebufferStartedAtMs = state.rebufferStartedAtMs;

  if (input.forwardBufferSeconds <= STARVATION_RUNWAY_SECONDS) {
    if (rebufferStartedAtMs == null) {
      rebufferStartedAtMs = input.nowMs;
    }
  } else if (rebufferStartedAtMs != null) {
    if (input.nowMs - rebufferStartedAtMs >= STARVATION_MIN_REBUFFER_MS) {
      rebufferTimesMs = [...rebufferTimesMs, rebufferStartedAtMs];
    }
    rebufferStartedAtMs = null;
  }

  const runwayStarvingSinceMs =
    input.forwardBufferSeconds <= STARVATION_RUNWAY_SECONDS
      ? state.runwayStarvingSinceMs ?? input.nowMs
      : null;
  const runwayStarved =
    runwayStarvingSinceMs != null &&
    input.nowMs - runwayStarvingSinceMs >= STARVATION_SUSTAIN_MS;
  const rebufferStarved =
    countRecentRebuffers(rebufferTimesMs, input.nowMs).count >=
    STARVATION_REBUFFER_THRESHOLD;

  return {
    state: {
      runwayStarvingSinceMs,
      rebufferStartedAtMs,
      rebufferTimesMs,
    },
    starved: runwayStarved || rebufferStarved,
  };
}

/** Seconds of media buffered strictly ahead of the playhead. */
export function getForwardBufferSeconds(
  currentTime: number,
  ranges: Array<{ start: number; end: number }>
): number {
  let ahead = 0;
  ranges.forEach((range) => {
    if (range.end <= currentTime || range.end <= range.start) {
      return;
    }
    const start = Math.max(range.start, currentTime);
    ahead = Math.max(ahead, range.end - start);
  });
  return ahead;
}
