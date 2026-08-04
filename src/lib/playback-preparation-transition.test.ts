import {
  type PlaybackPreparationIntent,
  createPlaybackPreparationState,
  reducePlaybackPreparationTransition,
} from './playback-preparation-transition';

const intent: PlaybackPreparationIntent = {
  href: '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4',
  cardKey: 'douban:hero-1',
  title: '庆余年',
  poster: 'https://img.example/poster.jpg',
  rect: { top: 120, left: 80, width: 160, height: 240 },
  origin: {
    href: '/?tab=favorites',
    scrollY: 640,
  },
};

describe('Playback Preparation Transition', () => {
  it('ends immediately when the first frame is ready during entry', () => {
    const started = reducePlaybackPreparationTransition(
      createPlaybackPreparationState(),
      { type: 'start', generation: 1, intent }
    );

    const ready = reducePlaybackPreparationTransition(started, {
      type: 'frameReady',
      generation: 1,
    });

    expect(ready.phase).toBe('ready');
    expect(ready.intent).toEqual(intent);
  });

  it('keeps returning after cancellation and ignores a late ready event', () => {
    const started = reducePlaybackPreparationTransition(
      createPlaybackPreparationState(),
      { type: 'start', generation: 2, intent }
    );
    const returning = reducePlaybackPreparationTransition(started, {
      type: 'cancel',
      generation: 2,
    });

    const afterLateReady = reducePlaybackPreparationTransition(returning, {
      type: 'frameReady',
      generation: 2,
    });

    expect(returning.phase).toBe('returning');
    expect(afterLateReady).toEqual(returning);
  });

  it('retains the origin after playback is ready until the return animation completes', () => {
    const started = reducePlaybackPreparationTransition(
      createPlaybackPreparationState(),
      { type: 'start', generation: 3, intent }
    );
    const ready = reducePlaybackPreparationTransition(started, {
      type: 'frameReady',
      generation: 3,
    });
    const returning = reducePlaybackPreparationTransition(ready, {
      type: 'return',
      generation: 3,
    });
    const restored = reducePlaybackPreparationTransition(returning, {
      type: 'returnComplete',
      generation: 3,
    });

    expect(returning).toMatchObject({ phase: 'returning', intent });
    expect(restored).toEqual(createPlaybackPreparationState());
  });
});
