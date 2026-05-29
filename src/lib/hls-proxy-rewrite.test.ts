import { rewritePlaylistContent } from './hls-proxy-rewrite';

describe('rewritePlaylistContent', () => {
  const proxyPrefix = 'https://app.example.com/api/hls-proxy?segmentMode=direct&url=';
  const baseUrl = 'https://media.example.com/show/master.m3u8';

  it('keeps nested playlists proxied but leaves media segments direct in direct segment mode', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'variant/playlist.m3u8',
      '#EXTINF:4.000,',
      'segment-001.ts',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.000,',
      'https://cdn.example.com/show/segment-002.ts',
    ].join('\n');

    const output = rewritePlaylistContent(input, baseUrl, proxyPrefix, {
      mediaSegmentMode: 'direct',
    });

    expect(output).toContain(
      'https://app.example.com/api/hls-proxy?segmentMode=direct&url=https%3A%2F%2Fmedia.example.com%2Fshow%2Fvariant%2Fplaylist.m3u8'
    );
    expect(output).toContain('https://media.example.com/show/segment-001.ts');
    expect(output).toContain('#EXT-X-MAP:URI="https://media.example.com/show/init.mp4"');
    expect(output).toContain('https://cdn.example.com/show/segment-002.ts');
  });

  it('keeps full segment proxying as the default mode', () => {
    const output = rewritePlaylistContent(
      ['#EXTM3U', '#EXTINF:4.000,', 'segment-001.ts'].join('\n'),
      baseUrl,
      'https://app.example.com/api/hls-proxy?url='
    );

    expect(output).toContain(
      'https://app.example.com/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Fsegment-001.ts'
    );
  });
});
