import { act, fireEvent, render, screen } from '@testing-library/react';

import PlaybackPreparationProvider, {
  usePlaybackPreparation,
} from './PlaybackPreparationProvider';

const push = jest.fn();
const back = jest.fn();
let pathname = '/';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, back }),
}));

function Harness({
  href = '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4',
}: {
  href?: string;
}) {
  const transition = usePlaybackPreparation();

  return (
    <>
      <button
        data-playback-preparation-card='douban:hero-1'
        onClick={() =>
          transition.start({
            href,
            cardKey: 'douban:hero-1',
            title: '庆余年',
            poster: 'https://img.example/poster.jpg',
            rect: { top: 120, left: 80, width: 160, height: 240 },
          })
        }
        type='button'
      >
        播放
      </button>
      <button onClick={transition.markFrameReady} type='button'>
        首帧
      </button>
      <button onClick={transition.markTerminalFailure} type='button'>
        失败
      </button>
    </>
  );
}

describe('PlaybackPreparationProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pathname = '/';
    push.mockReset();
    back.mockReset();
    window.history.replaceState({}, '', '/');
    window.scrollTo = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('navigates immediately, shows one neutral preparation state, and leaves on the first frame', () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    expect(push).toHaveBeenCalledWith(
      '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4'
    );
    expect(screen.getByRole('status')).toHaveTextContent('正在准备播放');
    expect(screen.queryByText(/搜源|线路|获取详情/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '首帧' }));
    act(() => {
      jest.advanceTimersByTime(220);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the preparation copy inside a short viewport', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720,
    });
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    const copy = screen.getByRole('status').parentElement;
    expect(Number.parseFloat(copy?.style.top ?? 'Infinity')).toBeLessThanOrEqual(
      window.innerHeight - 120
    );
  });

  it('uses a fade without moving the visual when reduced motion is requested', () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    const visual = screen.getByTestId('playback-preparation-visual');
    expect(visual).toHaveStyle({ opacity: '0' });
    expect(visual.style.transition).toBe('opacity 120ms linear');
    expect(visual.style.top).not.toBe('120px');
  });

  it('remeasures the real player frame when it mounts after navigation', async () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    const target = document.createElement('div');
    target.dataset.playbackPreparationTarget = '';
    target.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 96,
      left: 240,
      width: 800,
      height: 450,
      right: 1040,
      bottom: 546,
      x: 240,
      y: 96,
      toJSON: () => ({}),
    });
    await act(async () => {
      document.body.appendChild(target);
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(screen.getByTestId('playback-preparation-visual')).toHaveStyle({
      top: '96px',
      left: '240px',
      width: '800px',
      height: '450px',
    });
    target.remove();
  });

  it('cancels immediately, ignores a late first frame, and restores the source card', () => {
    const scrollIntoView = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('button', { name: '首帧' }));

    act(() => {
      jest.advanceTimersByTime(340);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '播放' })).toHaveFocus();
    expect(back).not.toHaveBeenCalled();
  });

  it('reveals the existing failure UI when playback reaches a terminal failure', () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    act(() => {
      jest.advanceTimersByTime(220);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('restores the source card when browser history returns across query-only routes', () => {
    const scrollIntoView = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '首帧' }));
    act(() => {
      jest.advanceTimersByTime(220);
    });
    window.history.replaceState({}, '', '/');

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => {
      jest.advanceTimersByTime(340);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '播放' })).toHaveFocus();
  });

  it('returns again if a cancelled navigation reaches the target late', () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    act(() => {
      jest.advanceTimersByTime(340);
    });

    window.history.replaceState(
      {},
      '',
      '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4'
    );
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('rejects an old canplay and cancels a late query-only play navigation', () => {
    pathname = '/play';
    window.history.replaceState({}, '', '/play?title=old');
    render(
      <PlaybackPreparationProvider>
        <Harness href='/play?title=new' />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '首帧' }));
    act(() => {
      jest.advanceTimersByTime(220);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    act(() => {
      jest.advanceTimersByTime(340);
    });
    window.history.replaceState({}, '', '/play?title=new&source=late');
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('expires a cancelled navigation marker that never commits', () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    act(() => {
      jest.advanceTimersByTime(30_100);
    });
    window.history.replaceState(
      {},
      '',
      '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4'
    );
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(back).not.toHaveBeenCalled();
  });

  it('blocks background wheel scroll while the overlay is visible and releases it once the frame is ready', () => {
    render(
      <PlaybackPreparationProvider>
        <Harness />
      </PlaybackPreparationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    const dialog = screen.getByRole('dialog');

    const blockedWheel = new Event('wheel', { cancelable: true });
    dialog.dispatchEvent(blockedWheel);
    expect(blockedWheel.defaultPrevented).toBe(true);

    const blockedTouchMove = new Event('touchmove', { cancelable: true });
    dialog.dispatchEvent(blockedTouchMove);
    expect(blockedTouchMove.defaultPrevented).toBe(true);

    // Once the first frame is ready the overlay stops trapping scroll.
    fireEvent.click(screen.getByRole('button', { name: '首帧' }));
    const releasedWheel = new Event('wheel', { cancelable: true });
    dialog.dispatchEvent(releasedWheel);
    expect(releasedWheel.defaultPrevented).toBe(false);
  });
});
