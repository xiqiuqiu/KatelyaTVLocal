import type { PlaybackQoeRecord } from './playback-quality';

const WATCH_WINDOW_MS = 5 * 60_000;
const RECOVERY_LIMIT_MS = 30_000;
const RECOVERY_PROGRESS_MS = 3_000;
export const PLAYBACK_INTERRUPTION_MS = 1_000;

export const playbackQoeMessages = {
  'qoe.uninterrupted': '前台连续观看达标',
  'qoe.interrupted': '观看期间发生中断',
  'qoe.recovered': '故障恢复成功',
  'qoe.recovery-failed': '故障恢复失败',
} as const;

type QoeEvent = keyof typeof playbackQoeMessages;

/** Passive post-startup observations. The player still owns all recovery decisions. */
export function createPlaybackQoeObserver(
  publish: (record: PlaybackQoeRecord, event: QoeEvent) => void,
  now = () => performance.now()
) {
  let session: Pick<PlaybackQoeRecord, 'sessionId' | 'testSession'> | null =
    null;
  let onBannerWatched: (() => void) | undefined;
  let bannerWatchMs = 0;
  let visit = 0;
  let seq = 0;
  let watchedMs = 0;
  let uninterrupted: boolean | null = null;
  let recovered = 0;
  let failed = 0;
  let last: { at: number; position: number } | null = null;
  let recoveryProgressMs = 0;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let hasPlayed = false;

  const report = (event: QoeEvent) => {
    if (!session) return;
    publish(
      {
        ...session,
        rowKind: 'qoe',
        visit,
        seq: ++seq,
        uninterrupted,
        recovered,
        failed,
      },
      event
    );
  };

  const resetProgress = () => {
    last = null;
    recoveryProgressMs = 0;
  };

  const settleRecovery = (success: boolean | null) => {
    if (deadline === null) return;
    clearTimeout(deadline);
    deadline = null;
    recoveryProgressMs = 0;
    if (success === null) return;
    if (success) recovered++;
    else {
      failed++;
      hasPlayed = false;
    }
    report(success ? 'qoe.recovered' : 'qoe.recovery-failed');
  };

  const boundary = () => {
    resetProgress();
    settleRecovery(false);
  };

  const nextEpisode = () => {
    boundary();
    visit++;
    seq = watchedMs = recovered = failed = 0;
    uninterrupted = null;
    hasPlayed = false;
  };

  return {
    start(input: NonNullable<typeof session>, onWatched?: () => void) {
      settleRecovery(false);
      session = input;
      onBannerWatched = onWatched;
      bannerWatchMs = 0;
      visit = 0;
      nextEpisode();
    },
    nextEpisode,
    boundary,
    resetProgress,
    suspend() {
      resetProgress();
      settleRecovery(null);
    },
    finish() {
      boundary();
      session = null;
    },
    interrupt() {
      if (!session || !hasPlayed) return;
      resetProgress();
      if (deadline !== null) return;
      if (uninterrupted === null) uninterrupted = false;
      report('qoe.interrupted');
      deadline = setTimeout(() => settleRecovery(false), RECOVERY_LIMIT_MS);
    },
    progress(position: number, rate: number) {
      if (!session || rate <= 0) return false;
      const at = now();
      const previous = last;
      if (previous && at <= previous.at) return false;
      last = { at, position };
      if (!previous) return false;
      const elapsed = at - previous.at;
      const advanced = ((position - previous.position) / rate) * 1000;
      if (elapsed > 2000 || advanced > elapsed + 500) {
        recoveryProgressMs = 0;
        return false;
      }
      if (advanced <= 0) return false;
      hasPlayed = true;
      const playedMs = Math.min(elapsed, advanced);
      if (onBannerWatched) {
        bannerWatchMs += playedMs;
        if (bannerWatchMs >= WATCH_WINDOW_MS) {
          onBannerWatched();
          onBannerWatched = undefined;
        }
      }
      if (uninterrupted === null) {
        watchedMs += playedMs;
        if (watchedMs >= WATCH_WINDOW_MS) {
          uninterrupted = true;
          report('qoe.uninterrupted');
        }
      }
      if (deadline !== null) {
        recoveryProgressMs += playedMs;
        if (recoveryProgressMs >= RECOVERY_PROGRESS_MS) settleRecovery(true);
      }
      return true;
    },
  };
}
