import {
  analyzeM3U8AdCandidates,
  applyM3U8AdFiltering,
  filterAdsFromM3U8,
  formatM3U8AdFilterDebugMessage,
  getM3U8AdFilterDebugInfo,
  observeM3U8AdSignals,
} from './hls-ad-filter';
import { KNOWN_HLS_AD_RULES } from './hls-ad-rules';

function createSegments(
  count: number,
  prefix: string,
  host = 'media.example.com'
): string[] {
  return Array.from({ length: count }, (_item, index) => [
    '#EXTINF:10,',
    `https://${host}/${prefix}-${index + 1}.ts`,
  ]).flat();
}

function createRyplayDmcKnownAdCase(): string {
  return [
    '#EXTM3U',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-TARGETDURATION:11',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:10.416667,',
    '98c1525cd707d7d631d7afdded8ba238.ts',
    '#EXTINF:10.416667,',
    '5ad774c12e7d9c6358775a8162e696d6.ts',
    '#EXTINF:10.416667,',
    '889bd8b3d32e39a7e480f09b0b24617a.ts',
    '#EXTINF:10.416667,',
    '8c034c442a30f10cfa2b5795d5a3c8d8.ts',
    '#EXTINF:10.416667,',
    '4991ecc8f086b67675be7d7a8809f16d.ts',
    '#EXTINF:10.416667,',
    'dee3600c24df4fe8fe4a511db2f9cf7f.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.000000,',
    '6dae7b6174701f65469c3eaafceb255e.ts',
    '#EXTINF:5.480000,',
    '48dd5acf3523c15accf4668f92256683.ts',
    '#EXTINF:4.000000,',
    'a756fbb58de3fe6d280f3634fbb9e97e.ts',
    '#EXTINF:3.240000,',
    '4f41283191818136361705c95a412d65.ts',
    '#EXTINF:4.000000,',
    '5b40ab80a60ddf3554c7a0d6a288dc03.ts',
    '#EXTINF:1.280000,',
    'e808d97f1ff02c5296e22cb235ccaedb.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:10.416667,',
    '199d07d0558fe3bf505743c8243f4e1c.ts',
    '#EXTINF:10.416667,',
    '42d679afb0c8b4e2c1c4b02469d587bb.ts',
    '#EXTINF:10.416667,',
    '03d77ec912b175e49f77fcf4b2bd5728.ts',
    '#EXTINF:10.416667,',
    'a46c85c261a2877f31334fd66e058d5a.ts',
    '#EXTINF:10.416667,',
    'f4e2a96cb2c960e66de58f17bc4ae398.ts',
    '#EXTINF:10.416667,',
    '897d7f780d5109a904bb87897c9683cd.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
}

function createRyplayCasinoShortGroupCase(): string {
  return [
    '#EXTM3U',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-TARGETDURATION:9',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.583333,',
    'content-before-1.ts',
    '#EXTINF:4.166667,',
    'content-before-2.ts',
    '#EXTINF:4.166667,',
    'content-before-3.ts',
    '#EXTINF:2.916667,',
    'content-before-4.ts',
    '#EXTINF:4.166667,',
    'content-before-5.ts',
    '#EXTINF:1.166667,',
    'content-before-6.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.000000,',
    'casino-ad-1.ts',
    '#EXTINF:5.480000,',
    'casino-ad-2.ts',
    '#EXTINF:4.000000,',
    'casino-ad-3.ts',
    '#EXTINF:3.240000,',
    'casino-ad-4.ts',
    '#EXTINF:4.000000,',
    'casino-ad-5.ts',
    '#EXTINF:1.280000,',
    'casino-ad-6.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.166667,',
    'content-after-1.ts',
    '#EXTINF:4.166667,',
    'content-after-2.ts',
    '#EXTINF:4.166667,',
    'content-after-3.ts',
    '#EXTINF:2.958333,',
    'content-after-4.ts',
    '#EXTINF:8.125000,',
    'content-after-5.ts',
    '#EXTINF:3.625000,',
    'content-after-6.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
}

function createModuForeignPathInsertCase(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:3.753,',
    '/20230919/zQzvuLQv/1143kb/hls/content-before-1.ts',
    '#EXTINF:3.753,',
    '/20230919/zQzvuLQv/1143kb/hls/content-before-2.ts',
    '#EXTINF:3.333,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-1.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-2.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-3.ts',
    '#EXTINF:2.933,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-4.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-5.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-6.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-7.ts',
    '#EXTINF:1.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-8.ts',
    '#EXTINF:3.300,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-9.ts',
    '#EXTINF:0.667,',
    '/20260523/fILZBl9p/10047kb/hls/foreign-ad-10.ts',
    '#EXTINF:3.753,',
    '/20230919/zQzvuLQv/1143kb/hls/content-after-1.ts',
    '#EXTINF:3.753,',
    '/20230919/zQzvuLQv/1143kb/hls/content-after-2.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
}

function createRuyiRyplay12JjkS3Episode1Case(): string {
  return [
    '#EXTM3U',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-TARGETDURATION:8',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:7.549211,',
    '7d994bc68cf80bcc3aeb62d6834a1a0f.ts',
    '#EXTINF:4.170833,',
    'de932b2bed618a671b6b74129a2faf5f.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:3.294956,',
    '5046b4041aa822cdc48369c38dc8b0e7.ts',
    '#EXTINF:4.170833,',
    '10a32e39c0614f2366557b3eda961771.ts',
    '#EXTINF:4.170833,',
    '67deb25d2552d1d315fef8ecfb8937b3.ts',
    '#EXTINF:4.170833,',
    '3953b607206dfff90b77b43042936d28.ts',
    '#EXTINF:0.667333,',
    '9cbefbed5c7cb46d39489166e4919c0d.ts',
    '#EXTINF:6.506500,',
    '01e243fade73f156c08b68b836acfd4a.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.170833,',
    '07e6b5da11077314af13b8fc8fa637a4.ts',
    '#EXTINF:2.669333,',
    '35aaa208fec34352538b41b52e6b805d.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:6.006000,',
    '32d8764b8fce4b9ef4546395438ff0f9.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.170833,',
    'bef3f550e01ce9acff81a337d38689be.ts',
    '#EXTINF:4.170833,',
    'ab4d121a23ab5e7435b9dd668e608623.ts',
    '#EXTINF:4.170833,',
    '40e8cb440c21f6354564e7fe8eba9fa2.ts',
    '#EXTINF:1.334667,',
    '6565740a9e9e3963eaa6605077a40675.ts',
    '#EXTINF:4.170833,',
    'e247ee94729807348f91da54762e92b2.ts',
    '#EXTINF:6.131122,',
    '2c79145942d872bd70093e15e92118e6.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.170833,',
    '0f9749d04fee1f3130ad7758695b2a26.ts',
    '#EXTINF:5.922578,',
    '2b381afbd5e6d3090616a621a5a53821.ts',
    '#EXTINF:3.378378,',
    '72d7424610e576f290e51a48e34e0b77.ts',
    '#EXTINF:4.170833,',
    'abf506f673c6544122d5185d3267dceb.ts',
    '#EXTINF:5.630622,',
    'eee13f7ce5bd1f66a55af2a19f758533.ts',
    '#EXTINF:4.170833,',
    'be90370a3174e6296713ae7b0861a585.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.045711,',
    '240d5e0714be9babea8412c0df2ffde9.ts',
    '#EXTINF:0.750744,',
    '294f6dd63aa39af09be7558067a19848.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
}

describe('filterAdsFromM3U8', () => {
  it('analyzes high-confidence explicit ad markers before filtering', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'content-before.ts',
      '#EXT-X-CUE-OUT:20',
      '#EXTINF:10,',
      'ad-1.ts',
      '#EXTINF:10,',
      'ad-2.ts',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'content-after.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const analysis = analyzeM3U8AdCandidates(
      input,
      'https://media.example.com/show/index.m3u8'
    );

    expect(analysis.candidates).toEqual([
      expect.objectContaining({
        confidence: 'high',
        action: 'filter',
        reasons: expect.arrayContaining(['cue-marker']),
      }),
    ]);
    expect(applyM3U8AdFiltering(input, analysis)).not.toContain('ad-1.ts');
  });

  it('does not treat cue-in-only content after an ad break as an ad window', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'content-before.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-CUE-OUT:20',
      '#EXTINF:10,',
      'ad-1.ts',
      '#EXTINF:10,',
      'ad-2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'content-after-1.ts',
      '#EXTINF:10,',
      'content-after-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const analysis = analyzeM3U8AdCandidates(
      input,
      'https://media.example.com/show/index.m3u8'
    );

    expect(
      analysis.candidates.filter((candidate) => candidate.action === 'filter')
    ).toEqual([
      expect.objectContaining({
        startTimeSeconds: 10,
        endTimeSeconds: 30,
        segmentCount: 2,
        confidence: 'high',
        action: 'filter',
      }),
    ]);
    expect(
      analysis.candidates.filter((candidate) => candidate.action === 'filter')
    ).not.toContainEqual(
      expect.objectContaining({
        sampleUrls: expect.arrayContaining([
          expect.stringContaining('content-after'),
        ]),
      })
    );
  });

  it('observes low-confidence short discontinuity blocks without filtering them', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'main-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      'short-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:10,',
      'main-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const analysis = analyzeM3U8AdCandidates(
      input,
      'https://media.example.com/show/index.m3u8'
    );

    expect(analysis.candidates).toContainEqual(
      expect.objectContaining({
        confidence: 'low',
        action: 'observe',
        reasons: ['short-discontinuity'],
      })
    );
    expect(applyM3U8AdFiltering(input, analysis)).toContain('short-1.ts');
  });

  it('does not filter blocks based only on URL keywords', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'main-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:10,',
      'https://media.example.com/adventure-scene.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:10,',
      'main-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const analysis = analyzeM3U8AdCandidates(
      input,
      'https://media.example.com/show/index.m3u8'
    );

    expect(applyM3U8AdFiltering(input, analysis)).toContain(
      'adventure-scene.ts'
    );
    expect(analysis.summary.removedBlocks).toEqual([]);
  });

  it('automatically filters same-host foreign dated short segment runs', () => {
    const input = createModuForeignPathInsertCase();
    const analysis = analyzeM3U8AdCandidates(
      input,
      'https://play.example.com/20230919/zQzvuLQv/1143kb/hls/index.m3u8'
    );

    expect(analysis.candidates).toContainEqual(
      expect.objectContaining({
        ruleId: 'auto-foreign-path-short-run-v1',
        confidence: 'high',
        action: 'filter',
      })
    );
    expect(applyM3U8AdFiltering(input, analysis)).not.toContain(
      'foreign-ad-1.ts'
    );
  });

  it('records the ruyi ryplay 22-second midroll case in the known rule library', () => {
    expect(
      KNOWN_HLS_AD_RULES.some(
        (rule) => rule.id === 'ruyi-ryplay-22s-midroll-v1'
      )
    ).toBe(true);
  });

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

  it('keeps generic short discontinuity blocks unless a source-specific rule matches', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      ...createSegments(15, 'main-a'),
      '#EXT-X-DISCONTINUITY',
      ...createSegments(2, 'preroll'),
      '#EXT-X-DISCONTINUITY',
      ...createSegments(15, 'main-b'),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('main-a-1.ts');
    expect(output).toContain('main-b-15.ts');
    expect(output).toContain('preroll-1.ts');
    expect(output).toContain('preroll-2.ts');
  });

  it('does not report generic short discontinuity blocks as removed ads', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      ...createSegments(15, 'main-a'),
      '#EXT-X-DISCONTINUITY',
      ...createSegments(2, 'preroll'),
      '#EXT-X-DISCONTINUITY',
      ...createSegments(15, 'main-b'),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://media.example.com/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toEqual([]);
  });

  it('formats source-specific rule matches into a readable debug message', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      ...createSegments(6, 'main-a', 'cdn.ryplay12.com').flatMap(
        (line, index) => (index % 2 === 0 ? '#EXTINF:10.416667,' : line)
      ),
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4.000000,',
      'https://cdn.ryplay12.com/preroll-1.ts',
      '#EXTINF:5.480000,',
      'https://cdn.ryplay12.com/preroll-2.ts',
      '#EXTINF:4.000000,',
      'https://cdn.ryplay12.com/preroll-3.ts',
      '#EXTINF:3.240000,',
      'https://cdn.ryplay12.com/preroll-4.ts',
      '#EXTINF:4.000000,',
      'https://cdn.ryplay12.com/preroll-5.ts',
      '#EXTINF:1.280000,',
      'https://cdn.ryplay12.com/preroll-6.ts',
      '#EXT-X-DISCONTINUITY',
      ...createSegments(6, 'main-b', 'cdn.ryplay12.com').flatMap(
        (line, index) => (index % 2 === 0 ? '#EXTINF:10.416667,' : line)
      ),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const filtered = filterAdsFromM3U8(
      input,
      'https://cdn.ryplay12.com/20250403/16563_f4b58451/2000k/hls/index.m3u8'
    );
    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://cdn.ryplay12.com/20250403/16563_f4b58451/2000k/hls/index.m3u8'
    );

    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      '发现 1 段疑似广告内容'
    );
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      'ruyi-ryplay-22s-midroll-v1'
    );
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain('6 个片段');
  });

  it('observes ad signals without requiring callers to use a filtered playlist', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://media.example.com/content-before.ts',
      '#EXT-X-CUE-OUT:20',
      '#EXTINF:10,',
      'https://media.example.com/ad-1.ts',
      '#EXTINF:10,',
      'https://media.example.com/ad-2.ts',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'https://media.example.com/content-after.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const debugInfo = observeM3U8AdSignals(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(debugInfo.shouldLog).toBe(true);
    expect(debugInfo.removedLineCount).toBeGreaterThan(0);
    expect(debugInfo.summary.removedBlocks.length).toBeGreaterThan(0);
    expect(input).toContain('ad-1.ts');
  });

  it('keeps generic tiny inline segments unless a source-specific rule matches', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://media.example.com/main-1.ts',
      '#EXTINF:0.01,',
      'https://track.example.vip/pixel.gif',
      '#EXTINF:10,',
      'https://media.example.com/main-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const output = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );

    expect(output).toContain('main-1.ts');
    expect(output).toContain('main-2.ts');
    expect(output).toContain('pixel.gif');
  });

  it('does not report generic tiny inline segments as removed ads', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://media.example.com/main-1.ts',
      '#EXTINF:0.01,',
      'https://track.example.vip/pixel.gif',
      '#EXTINF:10,',
      'https://media.example.com/main-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const filtered = filterAdsFromM3U8(
      input,
      'https://media.example.com/index.m3u8'
    );
    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://media.example.com/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toEqual([]);
  });

  it('removes the known ruyi ryplay 22-second midroll pattern and reports the rule id', () => {
    const input = createRyplayDmcKnownAdCase();
    const filtered = filterAdsFromM3U8(
      input,
      'https://cdn.ryplay12.com/20250403/16563_f4b58451/2000k/hls/index.m3u8'
    );

    expect(filtered).toContain('98c1525cd707d7d631d7afdded8ba238.ts');
    expect(filtered).toContain('199d07d0558fe3bf505743c8243f4e1c.ts');
    expect(filtered).not.toContain('6dae7b6174701f65469c3eaafceb255e.ts');
    expect(filtered).not.toContain('e808d97f1ff02c5296e22cb235ccaedb.ts');

    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://cdn.ryplay12.com/20250403/16563_f4b58451/2000k/hls/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toEqual([
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'ruyi-ryplay-22s-midroll-v1',
        segmentCount: 6,
        startTimeSeconds: expect.closeTo(62.5, 3),
        endTimeSeconds: expect.closeTo(84.5, 3),
      }),
    ]);
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      'ruyi-ryplay-22s-midroll-v1'
    );
  });

  it('removes the ruyi ryplay casino midroll even when neighboring content groups are short', () => {
    const input = createRyplayCasinoShortGroupCase();
    const filtered = filterAdsFromM3U8(
      input,
      'https://cdn.ryplay12.com/20260512/36030_e8d329b2/2000k/hls/index.m3u8'
    );

    expect(filtered).toContain('content-before-1.ts');
    expect(filtered).toContain('content-after-6.ts');
    expect(filtered).not.toContain('casino-ad-1.ts');
    expect(filtered).not.toContain('casino-ad-6.ts');

    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://cdn.ryplay12.com/20260512/36030_e8d329b2/2000k/hls/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toEqual([
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'ruyi-ryplay-casino-22s-midroll-v1',
        segmentCount: 6,
        durationSeconds: 22,
      }),
    ]);
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      'ruyi-ryplay-casino-22s-midroll-v1'
    );
  });

  it('removes moduapi modujx10 foreign-path inserted ad segments without discontinuity markers', () => {
    const input = createModuForeignPathInsertCase();
    const filtered = filterAdsFromM3U8(
      input,
      'https://play.modujx10.com/20230919/zQzvuLQv/1143kb/hls/index.m3u8'
    );

    expect(filtered).toContain('content-before-1.ts');
    expect(filtered).toContain('content-after-2.ts');
    expect(filtered).not.toContain('foreign-ad-1.ts');
    expect(filtered).not.toContain('foreign-ad-10.ts');

    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://play.modujx10.com/20230919/zQzvuLQv/1143kb/hls/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toEqual([
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'moduapi-modujx10-foreign-path-v1',
        segmentCount: 10,
        durationSeconds: expect.closeTo(20.235, 3),
      }),
    ]);
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      'moduapi-modujx10-foreign-path-v1'
    );
  });

  it('records and removes the ruyi ryplay12 iPad-reported midrolls by exact segment fingerprints', () => {
    const input = createRuyiRyplay12JjkS3Episode1Case();
    const filtered = filterAdsFromM3U8(
      input,
      'https://cdn.ryplay12.com/20260109/30954_0fe9a7a0/2000k/hls/index.m3u8'
    );

    expect(filtered).toContain('5046b4041aa822cdc48369c38dc8b0e7.ts');
    expect(filtered).toContain('01e243fade73f156c08b68b836acfd4a.ts');
    expect(filtered).not.toContain('10a32e39c0614f2366557b3eda961771.ts');
    expect(filtered).not.toContain('9cbefbed5c7cb46d39489166e4919c0d.ts');
    expect(filtered).not.toContain('bef3f550e01ce9acff81a337d38689be.ts');
    expect(filtered).not.toContain('6565740a9e9e3963eaa6605077a40675.ts');
    expect(filtered).not.toContain('abf506f673c6544122d5185d3267dceb.ts');
    expect(filtered).not.toContain('240d5e0714be9babea8412c0df2ffde9.ts');

    const debugInfo = getM3U8AdFilterDebugInfo(
      input,
      filtered,
      'https://cdn.ryplay12.com/20260109/30954_0fe9a7a0/2000k/hls/index.m3u8'
    );

    expect(debugInfo.summary.removedBlocks).toHaveLength(3);
    expect(debugInfo.summary.removedBlocks).toEqual([
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'ruyi-ryplay12-jjk-s3-ep1-20260109-v1',
        segmentCount: 4,
        durationSeconds: expect.closeTo(13.18, 2),
      }),
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'ruyi-ryplay12-jjk-s3-ep1-20260109-v1',
        segmentCount: 4,
        durationSeconds: expect.closeTo(13.847, 3),
      }),
      expect.objectContaining({
        reason: 'known-rule',
        ruleId: 'ruyi-ryplay12-jjk-s3-ep1-20260109-v1',
        segmentCount: 4,
        durationSeconds: expect.closeTo(18.018, 3),
      }),
    ]);
    expect(formatM3U8AdFilterDebugMessage(debugInfo)).toContain(
      'ruyi-ryplay12-jjk-s3-ep1-20260109-v1'
    );
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
