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

  it('switches when low buffer and slow progress persist through the sustain window', () => {
    let state = createPlaybackStarvationState();
    const start = 5_000;
    let starved = false;

    for (let elapsed = 0; elapsed <= STARVATION_SUSTAIN_MS; elapsed += 1_000) {
      const sample = samplePlaybackStarvation(state, {
        nowMs: start + elapsed,
        currentTime: 120 + elapsed / 10_000,
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
        currentTime: 30.1 + index,
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
        currentTime: index + 0.1,
        forwardBufferSeconds: 4,
      }).state;
    }
    expect(state.rebufferTimesMs).toHaveLength(2);

    const later = samplePlaybackStarvation(state, {
      nowMs: 30_000,
      currentTime: 20,
      forwardBufferSeconds: 0,
    });
    const resumed = samplePlaybackStarvation(later.state, {
      nowMs: 30_800,
      currentTime: 20.1,
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
      0
    );
  });

  it('does not switch during smooth playback with repeated low-buffer dips', () => {
    let state = createPlaybackStarvationState();

    for (let elapsed = 0; elapsed <= 12_000; elapsed += 250) {
      const result = samplePlaybackStarvation(state, {
        nowMs: elapsed,
        currentTime: 100 + elapsed / 1000,
        forwardBufferSeconds: elapsed % 4000 < 1000 ? 1.5 : 4,
      });
      state = result.state;
      expect(result.starved).toBe(false);
    }
    expect(state.rebufferTimesMs).toEqual([]);
  });

  it('does not switch when a small buffer sustains realtime playback', () => {
    let state = createPlaybackStarvationState();

    for (let elapsed = 0; elapsed <= 12_000; elapsed += 250) {
      const result = samplePlaybackStarvation(state, {
        nowMs: elapsed,
        currentTime: 100 + elapsed / 1000,
        forwardBufferSeconds: 1.5,
      });
      state = result.state;
      expect(result.starved).toBe(false);
    }
  });

  it('does not count a future range beyond a buffer gap as playable runway', () => {
    expect(
      getForwardBufferSeconds(100, [
        { start: 90, end: 100.5 },
        { start: 110, end: 140 },
      ])
    ).toBe(0.5);
    expect(getForwardBufferSeconds(100, [{ start: 110, end: 140 }])).toBe(0);
    expect(getForwardBufferSeconds(100, [{ start: 90, end: 100 }])).toBe(0);
    expect(getForwardBufferSeconds(100, [])).toBe(0);
  });

  it.each([0.5, 2])('respects smooth playback at %sx speed', (playbackRate) => {
    let state = createPlaybackStarvationState();

    for (let elapsed = 0; elapsed <= 12_000; elapsed += 250) {
      const result = samplePlaybackStarvation(state, {
        nowMs: elapsed,
        currentTime: 100 + (elapsed / 1000) * playbackRate,
        forwardBufferSeconds: elapsed % 4000 < 1000 ? 1.5 : 4,
        playbackRate,
      });
      state = result.state;
      expect(result.starved).toBe(false);
    }
    expect(state.rebufferTimesMs).toEqual([]);
  });

  it('starts a fresh progress comparison when playback speed changes', () => {
    const slow = samplePlaybackStarvation(createPlaybackStarvationState(), {
      nowMs: 0,
      currentTime: 100,
      forwardBufferSeconds: 1.5,
      playbackRate: 0.5,
    });
    const changed = samplePlaybackStarvation(slow.state, {
      nowMs: 5000,
      currentTime: 102.5,
      forwardBufferSeconds: 1.5,
      playbackRate: 2,
    });
    const playing = samplePlaybackStarvation(changed.state, {
      nowMs: 11_000,
      currentTime: 114.5,
      forwardBufferSeconds: 1.5,
      playbackRate: 2,
    });
    expect(changed.starved).toBe(false);
    expect(playing.starved).toBe(false);
  });

  it.each(['paused', 'seeking', 'ended'] as const)(
    'discards previous waits and restarts the clock after %s',
    (flag) => {
      let state = createPlaybackStarvationState();
      for (let index = 0; index < 2; index += 1) {
        state = samplePlaybackStarvation(state, {
          nowMs: index * 2000,
          currentTime: 100 + index,
          forwardBufferSeconds: 0,
        }).state;
        state = samplePlaybackStarvation(state, {
          nowMs: index * 2000 + 800,
          currentTime: 100.1 + index,
          forwardBufferSeconds: 4,
        }).state;
      }
      expect(state.rebufferTimesMs).toHaveLength(2);

      const interrupted = samplePlaybackStarvation(state, {
        nowMs: 4000,
        currentTime: 101.1,
        forwardBufferSeconds: 0,
        [flag]: true,
      });
      const resumed = samplePlaybackStarvation(interrupted.state, {
        nowMs: 12_000,
        currentTime: 101.1,
        forwardBufferSeconds: 0,
      });
      const recovered = samplePlaybackStarvation(resumed.state, {
        nowMs: 12_800,
        currentTime: 101.2,
        forwardBufferSeconds: 4,
      });

      expect(interrupted.starved).toBe(false);
      expect(resumed.starved).toBe(false);
      expect(recovered.starved).toBe(false);
      expect(recovered.state.rebufferTimesMs).toHaveLength(1);
    }
  );
});
