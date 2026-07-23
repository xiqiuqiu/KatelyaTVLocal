import {
  consumePlayIdentityInitSkip,
  isArtPlayerBoundToContainer,
  resolvePlayUrlTitle,
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
        isArtPlayerBoundToContainer(
          { template: { $container: inner } },
          host
        )
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
