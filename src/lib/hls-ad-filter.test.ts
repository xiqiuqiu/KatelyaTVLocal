import { filterAdsFromM3U8 } from './hls-ad-filter';

describe('filterAdsFromM3U8', () => {
  it('removes cue-out ranges without dropping surrounding content', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'main-1.ts',
      '#EXT-X-CUE-OUT:30',
      '#EXTINF:10,',
      'ad-1.ts',
      '#EXTINF:10,',
      'ad-2.ts',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'main-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('main-1.ts');
    expect(output).toContain('main-2.ts');
    expect(output).not.toContain('ad-1.ts');
    expect(output).not.toContain('ad-2.ts');
    expect(output).not.toContain('#EXT-X-CUE-OUT');
    expect(output).not.toContain('#EXT-X-CUE-IN');
  });

  it('removes discontinuity-wrapped ad blocks marked by SCTE35', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:8',
      '#EXTINF:8,',
      'https://media.example.com/segment-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-SCTE35:BASE64PAYLOAD',
      '#EXTINF:5,',
      'https://ads.example.com/preroll-1.ts',
      '#EXTINF:5,',
      'https://ads.example.com/preroll-2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:8,',
      'https://media.example.com/segment-2.ts',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('segment-1.ts');
    expect(output).toContain('segment-2.ts');
    expect(output).not.toContain('preroll-1.ts');
    expect(output).not.toContain('preroll-2.ts');
    expect(output.match(/#EXT-X-DISCONTINUITY/g)).toBeNull();
  });

  it('keeps normal discontinuity blocks intact', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:8',
      '#EXTINF:8,',
      'segment-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:8,',
      'segment-2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:8,',
      'segment-3.ts',
    ].join('\n');

    expect(
      filterAdsFromM3U8(input, 'https://media.example.com/index.m3u8')
    ).toBe(input);
  });

  it('removes alternate-host ad blocks when neighboring content uses the primary host', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:8',
      '#EXTINF:8,',
      'https://media.example.com/segment-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:5,',
      'https://ad-edge.example.org/spot-1.ts',
      '#EXTINF:5,',
      'https://ad-edge.example.org/spot-2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:8,',
      'https://media.example.com/segment-2.ts',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('segment-1.ts');
    expect(output).toContain('segment-2.ts');
    expect(output).not.toContain('spot-1.ts');
    expect(output).not.toContain('spot-2.ts');
  });

  it('removes ad blocks marked by daterange metadata', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:8',
      '#EXTINF:8,',
      'https://media.example.com/segment-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-DATERANGE:ID="ad-break-1",CLASS="ad",START-DATE="2026-05-11T00:00:00Z"',
      '#EXTINF:5,',
      'https://media.example.com/ad-roll-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:8,',
      'https://media.example.com/segment-2.ts',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('segment-1.ts');
    expect(output).toContain('segment-2.ts');
    expect(output).not.toContain('ad-roll-1.ts');
    expect(output).not.toContain('#EXT-X-DATERANGE');
  });

  it('leaves master playlists unchanged', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'low/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1600000',
      'high/index.m3u8',
    ].join('\n');

    expect(
      filterAdsFromM3U8(input, 'https://media.example.com/master.m3u8')
    ).toBe(input);
  });
});
