import {
  buildTvModeHref,
  getTvSeekTime,
  isTvBrowser,
  isTvDirectionalKey,
  isTvMode,
  resolveTvPlayerActivationTarget,
  resolveTvPlayerConfirmTarget,
  resolveTvPlayerHorizontalControlTarget,
  resolveTvRemoteClickTarget,
  shouldWakeTvPlayerControls,
} from '@/lib/tv-interaction';

describe('TV interaction baseline', () => {
  it('uses an explicit tv=1 entry without losing playback parameters', () => {
    const href = buildTvModeHref(
      'https://example.com/play?source=a&id=1#player',
      true
    );

    expect(href).toBe('/play?source=a&id=1&tv=1#player');
    expect(isTvMode(new URLSearchParams('source=a&tv=1'))).toBe(true);
    expect(buildTvModeHref(`https://example.com${href}`, false)).toBe(
      '/play?source=a&id=1&tv=0#player'
    );
  });

  it.each([
    [
      'Mozilla/5.0 (Linux; Android 13; 8R710_Q7FP Build/TQ1A.230205.002; wv) Chrome/101.0.4951.61',
      true,
    ],
    ['Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36', true],
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36', true],
    ['Mozilla/5.0 (Linux; Android 12; Android TV) Chrome/101.0', true],
    [
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S9180) Chrome/120.0 Mobile Safari/537.36',
      false,
    ],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0', false],
    ['', false],
  ])('detects television markers conservatively: %s', (ua, expected) => {
    expect(isTvBrowser(ua)).toBe(expected);
  });

  it('redirects an empty-pointerType virtual click to the focused control', () => {
    const focused = document.createElement('button');
    const fixedCoordinateTarget = document.createElement('button');

    expect(
      resolveTvRemoteClickTarget({
        pointerType: '',
        activeElement: focused,
        eventTarget: fixedCoordinateTarget,
      })
    ).toBe(focused);
    expect(
      resolveTvRemoteClickTarget({
        pointerType: 'mouse',
        activeElement: focused,
        eventTarget: fixedCoordinateTarget,
      })
    ).toBeNull();
  });

  it('keeps virtual confirmation on a focused player slider', () => {
    const focused = document.createElement('div');
    const fixedCoordinateTarget = document.createElement('button');
    focused.setAttribute('role', 'slider');

    expect(
      resolveTvRemoteClickTarget({
        pointerType: '',
        activeElement: focused,
        eventTarget: fixedCoordinateTarget,
      })
    ).toBe(focused);
    expect(
      resolveTvRemoteClickTarget({
        pointerType: '',
        activeElement: focused,
        eventTarget: focused,
      })
    ).toBe(focused);
  });

  it('leaves directional keys to television focus navigation', () => {
    expect(isTvDirectionalKey('ArrowLeft')).toBe(true);
    expect(isTvDirectionalKey('Enter')).toBe(false);
  });

  it('clamps focused progress seeking to the playable timeline', () => {
    expect(getTvSeekTime(5, 100, -10)).toBe(0);
    expect(getTvSeekTime(95, 100, 10)).toBe(100);
    expect(getTvSeekTime(50, 100, 10)).toBe(60);
  });

  it('wakes hidden native controls on the first fullscreen direction key', () => {
    expect(
      shouldWakeTvPlayerControls({
        key: 'ArrowUp',
        isTvMode: true,
        isFullscreen: true,
        controlsVisible: false,
        hasFocusedControl: false,
      })
    ).toBe(true);
    expect(
      shouldWakeTvPlayerControls({
        key: 'ArrowRight',
        isTvMode: true,
        isFullscreen: true,
        controlsVisible: true,
        hasFocusedControl: true,
      })
    ).toBe(false);
    expect(
      shouldWakeTvPlayerControls({
        key: 'ArrowDown',
        isTvMode: true,
        isFullscreen: false,
        controlsVisible: false,
        hasFocusedControl: false,
      })
    ).toBe(false);
  });

  it('moves horizontally across ArtPlayer left and right control groups', () => {
    const player = document.createElement('div');
    player.innerHTML = `
      <div class="art-controls">
        <div class="art-controls-left">
          <div data-tv-player-control="true" aria-label="播放"></div>
          <div data-tv-player-control="true" aria-label="下一集"></div>
        </div>
        <div class="art-controls-right">
          <div data-tv-player-control="true" aria-label="跳广告" style="display:none"></div>
          <div data-tv-player-control="true" aria-label="投屏"></div>
          <div data-tv-player-control="true" aria-label="设置"></div>
          <div data-tv-player-control="true" aria-label="全屏"></div>
        </div>
      </div>
    `;

    const controls = player.querySelectorAll<HTMLElement>(
      '[data-tv-player-control="true"]'
    );

    expect(
      resolveTvPlayerHorizontalControlTarget({
        player,
        current: controls[1],
        key: 'ArrowRight',
      })?.getAttribute('aria-label')
    ).toBe('投屏');
    expect(
      resolveTvPlayerHorizontalControlTarget({
        player,
        current: controls[3],
        key: 'ArrowRight',
      })?.getAttribute('aria-label')
    ).toBe('设置');
    expect(
      resolveTvPlayerHorizontalControlTarget({
        player,
        current: controls[3],
        key: 'ArrowLeft',
      })?.getAttribute('aria-label')
    ).toBe('下一集');
  });

  it('activates the focused ArtPlayer control with the remote confirm key', () => {
    const control = document.createElement('div');
    const player = document.createElement('div');
    control.dataset.tvPlayerControl = 'true';
    control.setAttribute('role', 'button');
    player.appendChild(control);
    const onClick = jest.fn();
    control.addEventListener('click', onClick);

    resolveTvPlayerConfirmTarget({
      key: 'Enter',
      eventTarget: control,
    })?.click();

    expect(onClick).toHaveBeenCalledTimes(1);

    resolveTvPlayerConfirmTarget({
      key: 'Enter',
      eventTarget: player,
      activeElement: control,
    })?.click();

    expect(onClick).toHaveBeenCalledTimes(2);
    const staleTarget = document.createElement('div');
    staleTarget.dataset.tvPlayerControl = 'true';
    staleTarget.setAttribute('role', 'button');
    player.appendChild(staleTarget);
    expect(
      resolveTvPlayerConfirmTarget({
        key: 'Enter',
        eventTarget: staleTarget,
        activeElement: control,
      })
    ).toBe(control);
  });

  it('activates the visible native icon inside an ArtPlayer control', () => {
    const control = document.createElement('div');
    control.innerHTML = `
      <i class="art-icon art-icon-volume" style="display:none"></i>
      <i class="art-icon art-icon-volume-close"></i>
    `;

    expect(
      resolveTvPlayerActivationTarget(control).classList.contains(
        'art-icon-volume-close'
      )
    ).toBe(true);
    const customControl = document.createElement('div');
    expect(resolveTvPlayerActivationTarget(customControl)).toBe(customControl);
  });
});
