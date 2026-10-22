import {
  consumePlayIdentityInitSkip,
  consumeSystemPause,
  isArtPlayerBoundToContainer,
  resolveEpisodeProgressSnapshot,
  resolvePlayUrlTitle,
  shouldApplyQueuedResumeForEpisode,
  shouldArmSystemPauseForUrlSwitch,
  shouldAutoAdvanceEndedEpisode,
  shouldSkipLeavingProgressSave,
  shouldSkipPlayIdentityInitForUrlRewrite,
} from '@/lib/play-page-player-lifecycle';

describe('play-page player lifecycle', () => {
  describe('isArtPlayerBoundToContainer', () => {
    it('is false when the React host was unmounted (stale artPlayerRef)', () => {
      const host = document.createElement('div');
      const inner = document.createElement('div');
      host.appendChild(inner);
      document.body.appendChild(host);

      const player = { template: { $container: inner } };

      // Soft source switch re-enters loading and React removes the host.
      host.remove();

      expect(isArtPlayerBoundToContainer(player, host)).toBe(false);
    });

    it('is true when the player container is still inside the live host', () => {
      const host = document.createElement('div');
      const inner = document.createElement('div');
      host.appendChild(inner);
      document.body.appendChild(host);

      expect(
        isArtPlayerBoundToContainer({ template: { $container: inner } }, host)
      ).toBe(true);

      host.remove();
    });

    it('forces recreate when the host is empty even if a player object exists', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      expect(isArtPlayerBoundToContainer({ template: {} }, host)).toBe(false);

      host.remove();
    });
  });

  describe('shouldSkipPlayIdentityInitForUrlRewrite', () => {
    const params = (query: string) => new URLSearchParams(query);

    it('skips when init drops prefer after choosing the requested source', () => {
      expect(
        shouldSkipPlayIdentityInitForUrlRewrite(
          params('source=a&id=1&title=T&prefer=true'),
          params('source=a&id=1&title=T&year=2001')
        )
      ).toBe(true);
    });

    it('skips when init settles on a different preferred source', () => {
      expect(
        shouldSkipPlayIdentityInitForUrlRewrite(
          params('source=a&id=1&title=T&prefer=true'),
          params('source=b&id=2&title=T')
        )
      ).toBe(true);
    });

    it('does not arm a skip when only non-identity params change', () => {
      expect(
        shouldSkipPlayIdentityInitForUrlRewrite(
          params('source=a&id=1&title=T'),
          params('source=a&id=1&title=T&year=2001')
        )
      ).toBe(false);
    });
  });

  describe('system pause from a URL switch', () => {
    it('arms only when the switch will really pause a playing video', () => {
      const urls = { currentUrl: 'a.m3u8', nextUrl: 'b.m3u8' };
      expect(
        shouldArmSystemPauseForUrlSwitch({ videoPaused: false, ...urls })
      ).toBe(true);
      expect(
        shouldArmSystemPauseForUrlSwitch({ videoPaused: true, ...urls })
      ).toBe(false);
      expect(
        shouldArmSystemPauseForUrlSwitch({ videoPaused: undefined, ...urls })
      ).toBe(false);
      expect(
        shouldArmSystemPauseForUrlSwitch({
          videoPaused: false,
          currentUrl: 'a.m3u8',
          nextUrl: 'a.m3u8',
        })
      ).toBe(false);
    });

    it('treats the armed pause as system and the next one as the user', () => {
      expect(consumeSystemPause(true)).toEqual({
        isUserPause: false,
        clearPending: true,
      });
      expect(consumeSystemPause(false)).toEqual({
        isUserPause: true,
        clearPending: false,
      });
    });
  });

  describe('consumePlayIdentityInitSkip', () => {
    it('skips one identity init after a soft source switch replaceState', () => {
      expect(consumePlayIdentityInitSkip(true)).toEqual({
        runInit: false,
        clearSkip: true,
      });
      expect(consumePlayIdentityInitSkip(false)).toEqual({
        runInit: true,
        clearSkip: false,
      });
    });
  });

  describe('shouldAutoAdvanceEndedEpisode', () => {
    it('advances only while the page is still on the episode that ended', () => {
      expect(
        shouldAutoAdvanceEndedEpisode({
          endedEpisodeIndex: 0,
          currentEpisodeIndex: 0,
        })
      ).toBe(true);
      expect(
        shouldAutoAdvanceEndedEpisode({
          endedEpisodeIndex: 0,
          currentEpisodeIndex: 4,
        })
      ).toBe(false);
    });
  });

  describe('shouldSkipLeavingProgressSave', () => {
    it('skips the leaving save while an ended auto-advance is still pending', () => {
      expect(
        shouldSkipLeavingProgressSave({ pendingEndedAutoAdvance: true })
      ).toBe(true);
      expect(
        shouldSkipLeavingProgressSave({ pendingEndedAutoAdvance: false })
      ).toBe(false);
    });
  });

  describe('shouldApplyQueuedResumeForEpisode', () => {
    it('applies a queued resume only for the episode that parked it', () => {
      expect(
        shouldApplyQueuedResumeForEpisode({
          queuedEpisodeIndex: 0,
          currentEpisodeIndex: 0,
        })
      ).toBe(true);
      expect(
        shouldApplyQueuedResumeForEpisode({
          queuedEpisodeIndex: 0,
          currentEpisodeIndex: 4,
        })
      ).toBe(false);
      expect(
        shouldApplyQueuedResumeForEpisode({
          queuedEpisodeIndex: null,
          currentEpisodeIndex: 4,
        })
      ).toBe(false);
    });
  });

  describe('resolveEpisodeProgressSnapshot', () => {
    it('keeps the leaving episode index with that episode media times', () => {
      expect(
        resolveEpisodeProgressSnapshot({
          episodeIndex: 0,
          playTime: 2758.2,
          totalTime: 2758.9,
        })
      ).toEqual({ episodeIndex: 0, playTime: 2758, totalTime: 2758 });
    });

    it('drops non-finite media times instead of writing them onto the next episode', () => {
      expect(
        resolveEpisodeProgressSnapshot({
          episodeIndex: 4,
          playTime: Number.NaN,
          totalTime: Number.POSITIVE_INFINITY,
        })
      ).toEqual({ episodeIndex: 4, playTime: 0, totalTime: 0 });
    });
  });

  describe('resolvePlayUrlTitle', () => {
    it('does not replace a good URL title with an empty detail title', () => {
      expect(
        resolvePlayUrlTitle({
          detailTitle: '',
          urlTitle: '五十公里桃花坞6',
          fallbackTitle: 'fallback',
        })
      ).toBe('五十公里桃花坞6');
    });

    it('prefers a non-empty detail title', () => {
      expect(
        resolvePlayUrlTitle({
          detailTitle: '  新标题  ',
          urlTitle: '旧标题',
        })
      ).toBe('新标题');
    });
  });
});
