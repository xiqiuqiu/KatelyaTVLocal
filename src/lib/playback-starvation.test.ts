import {
  createPlaybackStarvationState,
  getForwardBufferSeconds,
  samplePlaybackStarvation,
  STARVATION_REBUFFER_THRESHOLD,
  STARVATION_SUSTAIN_MS,
} from './playback-starvation';

describe('playback starvation', () => {
  it('does not switch on a single short buffer dip', () => {
    const first = samplePlaybackStarvation(createPlaybackStarvationState(), {
      nowMs: 1_000,
      currentTime: 120,
      forwardBufferSeconds: 0.4,
    });
    const recovered = samplePlaybackStarvation(first.state, {
      nowMs: 1_000 + STARVATION_SUSTAIN_MS - 1,
      currentTime: 122,
      forwardBufferSeconds: 8,
    });

    expect(first.starved).toBe(false);
    expect(recovered.starved).toBe(false);
    expect(recovered.state.runwayStarvingSinceMs).toBeNull();
  });

  it('switches once forward buffer stays empty through the sustain window', () => {
    let state = createPlaybackStarvationState();
    const start = 5_000;
    let starved = false;

    for (let elapsed = 0; elapsed <= STARVATION_SUSTAIN_MS; elapsed += 1_000) {
      const sample = samplePlaybackStarvation(state, {
        nowMs: start + elapsed,
        currentTime: 120 + elapsed / 1000,
        forwardBufferSeconds: 0.5,
      });
      state = sample.state;
      starved = sample.starved;
    }

    expect(starved).toBe(true);
  });

  it('switches after repeated short rebuffers even if the playhead creeps', () => {
    let state = createPlaybackStarvationState();
    let starved = false;

    for (let index = 0; index < STARVATION_REBUFFER_THRESHOLD; index += 1) {
      const waiting = samplePlaybackStarvation(state, {
        nowMs: 10_000 + index * 4_000,
        currentTime: 30 + index,
        forwardBufferSeconds: 0,
      });
      const playing = samplePlaybackStarvation(waiting.state, {
        nowMs: 10_000 + index * 4_000 + 800,
        currentTime: 31 + index,
        forwardBufferSeconds: 6,
      });
      state = playing.state;
      starved = playing.starved;
    }

    expect(starved).toBe(true);
  });

  it('does not count a sub-notice wait or a pause as a rebuffer', () => {
    const waiting = samplePlaybackStarvation(createPlaybackStarvationState(), {
      nowMs: 1_000,
      currentTime: 40,
      forwardBufferSeconds: 0,
    });
    const blip = samplePlaybackStarvation(waiting.state, {
      nowMs: 1_200,
      currentTime: 40.1,
      forwardBufferSeconds: 5,
    });
    const paused = samplePlaybackStarvation(blip.state, {
      nowMs: 2_000,
      currentTime: 40.1,
      forwardBufferSeconds: 0,
      paused: true,
    });

    expect(blip.state.rebufferTimesMs).toEqual([]);
    expect(paused.starved).toBe(false);
    expect(paused.state.runwayStarvingSinceMs).toBeNull();
  });

  it('drops rebuffers that fall outside the window', () => {
    let state = createPlaybackStarvationState();

    for (let index = 0; index < 2; index += 1) {
      const waiting = samplePlaybackStarvation(state, {
        nowMs: index * 1_000,
        currentTime: index,
        forwardBufferSeconds: 0,
      });
      state = samplePlaybackStarvation(waiting.state, {
        nowMs: index * 1_000 + 500,
        currentTime: index + 0.5,
        forwardBufferSeconds: 4,
      }).state;
    }

    const later = samplePlaybackStarvation(state, {
      nowMs: 30_000,
      currentTime: 20,
      forwardBufferSeconds: 0,
    });
    const resumed = samplePlaybackStarvation(later.state, {
      nowMs: 30_800,
      currentTime: 21,
      forwardBufferSeconds: 4,
    });

    expect(resumed.starved).toBe(false);
  });

  it('measures only media buffered ahead of the playhead', () => {
    expect(
      getForwardBufferSeconds(10, [
        { start: 0, end: 9 },
        { start: 10, end: 13.5 },
      ])
    ).toBeCloseTo(3.5);
    expect(getForwardBufferSeconds(10, [{ start: 12, end: 14 }])).toBeCloseTo(
      2
    );
  });
});
