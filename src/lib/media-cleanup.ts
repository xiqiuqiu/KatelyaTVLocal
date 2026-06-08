type HlsLike = {
  stopLoad?: () => void;
  destroy?: () => void;
};

export type ManagedVideoElement = HTMLVideoElement & {
  hls?: HlsLike;
};

const runSafely = (action: () => void) => {
  try {
    action();
  } catch {
    // Cleanup should be best-effort; navigation away must not throw.
  }
};

export function stopVideoElementLoading(
  video: ManagedVideoElement | null | undefined
) {
  if (!video) return;

  const hls = video.hls;
  if (hls) {
    runSafely(() => hls.stopLoad?.());
    runSafely(() => hls.destroy?.());
    video.hls = undefined;
  }

  runSafely(() => video.pause());
  runSafely(() => video.removeAttribute('src'));
  runSafely(() => {
    Array.from(video.getElementsByTagName('source')).forEach((source) => {
      source.removeAttribute('src');
      source.remove();
    });
  });
  runSafely(() => video.load());
}
