/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  isCastableMediaUrl,
  requestCastPlayback,
  resolveCastMediaUrl,
} from './cast';

describe('cast media url resolver', () => {
  it('prefers the original public media url', () => {
    const result = resolveCastMediaUrl({
      directUrl: 'https://media.example.com/video/index.m3u8',
      proxyUrl: 'https://proxy.example.com/hls?url=encoded',
      playbackUrl: 'blob:http://localhost:3000/local',
    });

    expect(result).toEqual({
      url: 'https://media.example.com/video/index.m3u8',
      source: 'direct',
    });
  });

  it('falls back to a public proxy url when direct url cannot be cast', () => {
    const result = resolveCastMediaUrl({
      directUrl: 'blob:http://localhost:3000/local',
      proxyUrl: 'https://app.example.com/api/hls-proxy?url=encoded',
      playbackUrl: 'http://127.0.0.1:3000/api/hls-proxy?url=encoded',
    });

    expect(result).toEqual({
      url: 'https://app.example.com/api/hls-proxy?url=encoded',
      source: 'proxy',
    });
  });

  it('rejects browser-only and loopback urls', () => {
    expect(isCastableMediaUrl('blob:http://localhost:3000/video')).toBe(false);
    expect(isCastableMediaUrl('http://localhost:3000/api/hls')).toBe(false);
    expect(isCastableMediaUrl('http://127.0.0.1:3000/api/hls')).toBe(false);
    expect(isCastableMediaUrl('https://media.example.com/video.m3u8')).toBe(
      true
    );
  });

  it('returns a clear reason when no url can be cast', () => {
    const result = resolveCastMediaUrl({
      directUrl: 'blob:http://localhost:3000/video',
      proxyUrl: 'http://127.0.0.1:3000/api/hls-proxy?url=encoded',
      playbackUrl: '',
    });

    expect(result.url).toBeNull();
    expect(result.reason).toBe('没有可供电视访问的播放地址');
  });
});

describe('cast playback provider selection', () => {
  afterEach(() => {
    delete (window as any).chrome;
    delete (window as any).cast;
  });

  it('uses AirPlay before other providers when Safari exposes the picker', async () => {
    const showPicker = jest.fn();
    const video = document.createElement('video') as HTMLVideoElement & {
      webkitShowPlaybackTargetPicker: () => void;
    };
    video.webkitShowPlaybackTargetPicker = showPicker;

    const result = await requestCastPlayback({
      video,
      media: {
        title: '测试影片',
        directUrl: 'https://media.example.com/video.m3u8',
      },
    });

    expect(showPicker).toHaveBeenCalled();
    expect(result.provider).toBe('airplay');
    expect(result.status).toBe('connected');
  });

  it('falls back to Remote Playback when Google Cast is unavailable', async () => {
    const prompt = jest.fn().mockResolvedValue(undefined);
    const video = document.createElement('video') as HTMLVideoElement & {
      remote: { prompt: () => Promise<void> };
    };
    Object.defineProperty(video, 'remote', {
      configurable: true,
      value: { prompt },
    });

    const result = await requestCastPlayback({
      video,
      media: {
        title: '测试影片',
        directUrl: 'https://media.example.com/video.m3u8',
      },
    });

    expect(prompt).toHaveBeenCalled();
    expect(result.provider).toBe('remote-playback');
    expect(result.status).toBe('connected');
  });

  it('loads media through Google Cast when the Cast SDK is available', async () => {
    const setOptions = jest.fn();
    const requestSession = jest.fn().mockResolvedValue(undefined);
    const loadMedia = jest.fn().mockResolvedValue(undefined);
    const getCurrentSession = jest.fn(() => ({ loadMedia }));

    (window as any).chrome = {
      cast: {
        AutoJoinPolicy: {
          ORIGIN_SCOPED: 'origin_scoped',
        },
        Image: function Image(this: any, url: string) {
          this.url = url;
        },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: 'default-receiver',
          GenericMediaMetadata: function GenericMediaMetadata() {
            return {};
          },
          LoadRequest: function LoadRequest(this: any, mediaInfo: unknown) {
            this.media = mediaInfo;
          },
          MediaInfo: function MediaInfo(
            this: any,
            url: string,
            contentType: string
          ) {
            this.contentId = url;
            this.contentType = contentType;
          },
        },
      },
    };
    (window as any).cast = {
      framework: {
        CastContext: {
          getInstance: () => ({
            setOptions,
            requestSession,
            getCurrentSession,
          }),
        },
      },
    };

    const video = document.createElement('video') as HTMLVideoElement & {
      remote: { prompt: () => Promise<void> };
    };
    Object.defineProperty(video, 'remote', {
      configurable: true,
      value: { prompt: jest.fn() },
    });

    const result = await requestCastPlayback({
      video,
      media: {
        title: '测试影片',
        subtitle: '第 1 集',
        poster: 'https://media.example.com/poster.jpg',
        directUrl: 'https://media.example.com/video.m3u8',
      },
    });

    expect(setOptions).toHaveBeenCalledWith({
      receiverApplicationId: 'default-receiver',
      autoJoinPolicy: 'origin_scoped',
    });
    expect(requestSession).toHaveBeenCalled();
    expect(loadMedia).toHaveBeenCalled();
    expect(result.provider).toBe('google-cast');
    expect(result.status).toBe('connected');
  });
});
