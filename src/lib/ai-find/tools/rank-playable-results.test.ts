import { probeSourcePlaybackWithCache } from '@/lib/source-preference';
import type { SearchResult } from '@/lib/types';

import {
  rankPlayableResults,
  rankSearchResultGroupItems,
} from './rank-playable-results';

jest.mock('@/lib/source-preference', () => {
  const actual = jest.requireActual('@/lib/source-preference');

  return {
    ...actual,
    probeSourcePlaybackWithCache: jest.fn(),
  };
});

function makeResult(override: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '隐秘的角落',
    poster: '',
    episodes: ['https://alpha.example/1.m3u8'],
    source: 'alpha',
    source_name: 'Alpha',
    year: '2020',
    ...override,
  };
}

describe('rank playable results', () => {
  const mockedProbeSourcePlaybackWithCache =
    probeSourcePlaybackWithCache as jest.MockedFunction<
      typeof probeSourcePlaybackWithCache
    >;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sorts direct results ahead of proxy and missing-playback sources', async () => {
    mockedProbeSourcePlaybackWithCache.mockImplementation(async (targetUrl) => {
      if (targetUrl.includes('beta')) {
        return {
          kind: 'direct',
          reason: '可直连',
          probeTimeMs: 120,
          cacheState: 'miss',
        };
      }

      return {
        kind: 'proxy',
        reason: '需要代理',
        probeTimeMs: 240,
        cacheState: 'miss',
      };
    });

    const ranked = await rankPlayableResults({
      items: [
        {
          sourceKey: 'alpha',
          id: '1',
          episodeUrl: 'https://alpha.example/1.m3u8',
        },
        {
          sourceKey: 'beta',
          id: '2',
          episodeUrl: 'https://beta.example/1.m3u8',
        },
        {
          sourceKey: 'gamma',
          id: '3',
          episodeUrl: null,
        },
      ],
      origin: 'https://app.example.com',
    });

    expect(ranked.orderedItems.map((item) => item.sourceKey)).toEqual([
      'beta',
      'alpha',
      'gamma',
    ]);
    expect(ranked.orderedItems[0].kind).toBe('direct');
    expect(ranked.orderedItems[2].kind).toBe('unavailable');
  });

  it('reorders aggregate search items so the best playback source is first', async () => {
    mockedProbeSourcePlaybackWithCache.mockImplementation(async (targetUrl) => {
      if (targetUrl.includes('beta')) {
        return {
          kind: 'direct',
          reason: '可直连',
          probeTimeMs: 80,
          cacheState: 'hit',
        };
      }

      return {
        kind: 'proxy',
        reason: '需要代理',
        probeTimeMs: 180,
        cacheState: 'miss',
      };
    });

    const rankedGroup = await rankSearchResultGroupItems({
      items: [
        makeResult({
          id: '1',
          source: 'alpha',
          source_name: 'Alpha',
          episodes: ['https://alpha.example/1.m3u8'],
        }),
        makeResult({
          id: '2',
          source: 'beta',
          source_name: 'Beta',
          episodes: ['https://beta.example/1.m3u8'],
        }),
      ],
      origin: 'https://app.example.com',
    });

    expect(rankedGroup.items[0].source).toBe('beta');
    expect(rankedGroup.playbackHint).toBe('direct');
  });
});
