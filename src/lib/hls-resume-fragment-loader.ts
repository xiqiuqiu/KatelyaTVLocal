import type { FragmentLoaderContext, HlsConfig } from 'hls.js';

export function createHlsResumeFragmentLoader(
  BaseLoader: HlsConfig['loader'],
  resumeTime: number,
  onProgress: (atMs: number | null) => void
): NonNullable<HlsConfig['fLoader']> {
  let currentRequest: XMLHttpRequest | undefined;
  return class extends BaseLoader {
    declare context: FragmentLoaderContext | null;

    constructor(config: HlsConfig) {
      super({
        ...config,
        xhrSetup: async (xhr, url) => {
          await config.xhrSetup?.(xhr, url);
          const fragment = this.context?.frag;
          if (
            fragment?.type !== 'main' ||
            fragment.sn === 'initSegment' ||
            resumeTime < fragment.start ||
            resumeTime >= fragment.end ||
            currentRequest === xhr
          )
            return;

          currentRequest = xhr;
          onProgress(null);
          let received = 0;
          xhr.addEventListener('progress', (event) => {
            if (
              currentRequest !== xhr ||
              !event.isTrusted ||
              event.loaded <= received
            )
              return;
            received = event.loaded;
            onProgress(performance.now());
          });
          xhr.addEventListener(
            'loadend',
            () => {
              if (currentRequest !== xhr) return;
              currentRequest = undefined;
              if (xhr.status < 200 || xhr.status >= 300) onProgress(null);
            },
            { once: true }
          );
        },
      });
    }
  };
}
