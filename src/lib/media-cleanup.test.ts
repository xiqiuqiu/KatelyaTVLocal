import {
  type ManagedVideoElement,
  stopVideoElementLoading,
} from './media-cleanup';

describe('stopVideoElementLoading', () => {
  const defineVideoMethod = (
    video: HTMLVideoElement,
    name: 'pause' | 'load',
    fn: jest.Mock
  ) => {
    Object.defineProperty(video, name, {
      configurable: true,
      value: fn,
    });
  };

  it('stops hls loading, destroys hls, and clears native media sources', () => {
    const video = document.createElement('video') as ManagedVideoElement;
    const source = document.createElement('source');
    const stopLoad = jest.fn();
    const destroy = jest.fn();
    const pause = jest.fn();
    const load = jest.fn();

    source.src = 'https://media.example.com/show/segment.m3u8';
    video.src = 'https://media.example.com/show/index.m3u8';
    video.appendChild(source);
    video.hls = { stopLoad, destroy };
    defineVideoMethod(video, 'pause', pause);
    defineVideoMethod(video, 'load', load);

    stopVideoElementLoading(video);

    expect(stopLoad).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(video.hls).toBeUndefined();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.getElementsByTagName('source')).toHaveLength(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('continues cleanup when one cleanup action throws', () => {
    const video = document.createElement('video') as ManagedVideoElement;
    const destroy = jest.fn(() => {
      throw new Error('destroy failed');
    });
    const pause = jest.fn();
    const load = jest.fn();

    video.src = 'https://media.example.com/show/index.m3u8';
    video.hls = { destroy };
    defineVideoMethod(video, 'pause', pause);
    defineVideoMethod(video, 'load', load);

    expect(() => stopVideoElementLoading(video)).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(video.hls).toBeUndefined();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.getAttribute('src')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
