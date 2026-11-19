import { createPlaybackQoeObserver } from './playback-qoe.client';

function setup(testSession = false) {
  const publish = jest.fn();
  let position = 0;
  const qoe = createPlaybackQoeObserver(publish, Date.now);
  qoe.start({ sessionId: 'session-1', testSession });
  const play = (seconds: number) => {
    qoe.progress(position, 1);
    for (let elapsed = 0; elapsed < seconds; elapsed++) {
      jest.advanceTimersByTime(1000);
      qoe.progress(++position, 1);
    }
  };
  return { qoe, play, publish };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('counts only actual active progress toward a five-minute clean visit', () => {
  const { qoe, play, publish } = setup();
  play(100);
  qoe.suspend();
  jest.advanceTimersByTime(600_000);
  play(199);
  expect(publish).not.toHaveBeenCalled();
  play(1);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      visit: 1,
      testSession: false,
      uninterrupted: true,
    }),
    'qoe.uninterrupted'
  );
  qoe.nextEpisode();
  qoe.interrupt();
  expect(publish).toHaveBeenCalledTimes(1);
});

it('credits sustained recovery, times out a separate failure and keeps the test flag', () => {
  const { qoe, play, publish } = setup(true);
  qoe.interrupt();
  expect(publish).not.toHaveBeenCalled();
  play(2);
  qoe.interrupt();
  qoe.interrupt();
  play(2);
  expect(publish).toHaveBeenCalledTimes(1);
  play(1);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      testSession: true,
      uninterrupted: false,
      recovered: 1,
      failed: 0,
    }),
    'qoe.recovered'
  );
  qoe.interrupt();
  jest.advanceTimersByTime(30_000);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ recovered: 1, failed: 1 }),
    'qoe.recovery-failed'
  );
  const settledCount = publish.mock.calls.length;
  qoe.interrupt();
  jest.advanceTimersByTime(30_000);
  expect(publish).toHaveBeenCalledTimes(settledCount);
});

it('does not credit a seek jump or censor user interruption as a recovery failure', () => {
  const { qoe, play, publish } = setup();
  play(2);
  qoe.interrupt();
  play(2);
  jest.advanceTimersByTime(500);
  qoe.progress(100, 1);
  jest.advanceTimersByTime(1000);
  qoe.progress(101, 1);
  qoe.suspend();
  jest.advanceTimersByTime(31_000);
  expect(publish).toHaveBeenCalledTimes(1);
});
