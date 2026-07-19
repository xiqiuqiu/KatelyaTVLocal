import {
  isHlsMediaPlaylistContent,
  selectPreferredHlsVariantUrl,
} from './hls-master-playlist';

describe('hls-master-playlist', () => {
  it('detects media playlists by EXTINF', () => {
    expect(
      isHlsMediaPlaylistContent('#EXTM3U\n#EXTINF:10,\nseg.ts\n')
    ).toBe(true);
    expect(
      isHlsMediaPlaylistContent(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n'
      )
    ).toBe(false);
  });

  it('selects the highest-resolution variant from a master playlist', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
      'low/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720',
      'high/index.m3u8',
    ].join('\n');

    expect(
      selectPreferredHlsVariantUrl(
        master,
        'https://media.example.com/show/index.m3u8'
      )
    ).toBe('https://media.example.com/show/high/index.m3u8');
  });

  it('falls back to highest BANDWIDTH when RESOLUTION is omitted', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'low/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1600000',
      'high/index.m3u8',
    ].join('\n');

    expect(
      selectPreferredHlsVariantUrl(
        master,
        'https://media.example.com/show/index.m3u8'
      )
    ).toBe('https://media.example.com/show/high/index.m3u8');
  });

  it('returns null when the playlist has no STREAM-INF variants', () => {
    expect(
      selectPreferredHlsVariantUrl(
        '#EXTM3U\n#EXTINF:10,\nseg.ts\n',
        'https://media.example.com/show/index.m3u8'
      )
    ).toBeNull();
  });
});
