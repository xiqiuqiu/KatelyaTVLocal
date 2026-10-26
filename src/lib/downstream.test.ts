import type { ApiSite } from './config';
import { getConfig } from './config';
import { getDetailFromApi, searchFromApi } from './downstream';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      pagePath: '?ac=videolist&wd={query}&pg={page}',
      headers: {
        Accept: 'application/json',
      },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: {
        Accept: 'application/json',
      },
    },
  },
  getConfig: jest.fn(),
}));

describe('searchFromApi config usage', () => {
  const apiSite: ApiSite = {
    key: 'source-a',
    name: 'Source A',
    api: 'https://source.example.com/api.php',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pagecount: 3,
        list: [
          {
            vod_id: 1,
            vod_name: '示例',
            vod_pic: '',
            vod_play_url: '第1集$https://video.example.com/1.m3u8',
            vod_class: '',
            vod_year: '2026',
            vod_content: '',
          },
        ],
      }),
    }) as unknown as typeof fetch;
  });

  it('uses provided maxSearchPages without reading global config', async () => {
    await searchFromApi(apiSite, '示例', { maxSearchPages: 2 });

    expect(getConfig).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('pg=2');
  });

  it('returns clean episode playlists when a paginated result includes web-player and HLS groups', async () => {
    const paginatedItem = {
      vod_id: '151407',
      vod_name: '思想验证区域第二季',
      vod_pic: '',
      vod_year: '2026',
      vod_play_url:
        '第1期$https://vv.jisuzyv.com/play/epY2yKVa#第2期$https://vv.jisuzyv.com/play/b4xLMDxb$$$第1期$https://vv.jisuzyv.com/play/epY2yKVa/index.m3u8#第2期$https://vv.jisuzyv.com/play/b4xLMDxb/index.m3u8',
    };
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        pagecount: 2,
        list: [{ ...paginatedItem, vod_id: 'other', vod_name: '其他节目' }],
      }),
    } as Response);
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ list: [paginatedItem] }),
    } as Response);

    const results = await searchFromApi(apiSite, '思想验证区域 第二季', {
      maxSearchPages: 2,
    });
    expect(results.find((result) => result.id === '151407')?.episodes).toEqual([
      'https://vv.jisuzyv.com/play/epY2yKVa/index.m3u8',
      'https://vv.jisuzyv.com/play/b4xLMDxb/index.m3u8',
    ]);
  });

  it('selects the playlist group for details and preserves signed query parameters', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        list: [
          {
            vod_id: '151407',
            vod_name: '思想验证区域第二季',
            vod_pic: '',
            vod_content: '',
            vod_play_url:
              '第1期$https://video.example/player/1#第2期$https://video.example/player/2$$$第1期$https://video.example/1.m3u8?sign=first&expires=123#第2期$https://video.example/2.m3u8?sign=second',
          },
        ],
      }),
    } as Response);
    const detail = await getDetailFromApi(apiSite, '151407');
    expect(detail.episodes).toEqual([
      'https://video.example/1.m3u8?sign=first&expires=123',
      'https://video.example/2.m3u8?sign=second',
    ]);
  });

  it('keeps legacy direct video details playable when there is no playlist group', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        list: [
          {
            vod_id: '1',
            vod_name: '影片',
            vod_pic: '',
            vod_content: '',
            vod_play_url: '正片$https://video.example/movie.mp4?token=abc',
          },
        ],
      }),
    } as Response);
    expect((await getDetailFromApi(apiSite, '1')).episodes).toEqual([
      'https://video.example/movie.mp4?token=abc',
    ]);
  });

  it.each([
    'https://video.example/movie(1).mp4?token=a(b)&expires=123',
    'https://video.example/movie(1).m3u8?token=a(b)&expires=123',
  ])('preserves parentheses in a valid detail URL: %s', async (url) => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        list: [
          {
            vod_name: '影片',
            vod_pic: '',
            vod_content: '',
            vod_play_url: `正片$${url}`,
          },
        ],
      }),
    } as Response);
    expect((await getDetailFromApi(apiSite, '1')).episodes).toEqual([url]);
  });

  it.each(['search', 'detail'] as const)(
    'preserves episode order in a mixed media group for %s',
    async (kind) => {
      const item = {
        vod_id: '1',
        vod_name: '剧集',
        vod_pic: '',
        vod_content: '',
        vod_play_url:
          '第1集$https://video.example/1.m3u8#第2集$https://video.example/2.mp4#第3集$https://video.example/3.m3u8',
      };
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pagecount: 1, list: [item] }),
      } as Response);
      const result =
        kind === 'search'
          ? (await searchFromApi(apiSite, '剧集', { maxSearchPages: 1 }))[0]
          : await getDetailFromApi(apiSite, '1');
      expect(result.episodes).toEqual([
        'https://video.example/1.m3u8',
        'https://video.example/2.mp4',
        'https://video.example/3.m3u8',
      ]);
    }
  );

  it('keeps a search result with a null playback field and allows detail content fallback', async () => {
    const item = {
      vod_id: '1',
      vod_name: '影片',
      vod_pic: '',
      vod_play_url: null,
      vod_content: 'https://video.example/fallback.m3u8?token=a(b)',
    };
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ pagecount: 1, list: [item] }),
    } as Response);
    expect(await searchFromApi(apiSite, '影片', { maxSearchPages: 1 })).toEqual(
      [expect.objectContaining({ id: '1', episodes: [] })]
    );
    expect((await getDetailFromApi(apiSite, '1')).episodes).toEqual([
      'https://video.example/fallback.m3u8?token=a(b)',
    ]);
  });

  it('extracts complete signed playlists from a special detail page without consuming other playback groups', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<h1>思想验证区域第二季</h1><script>const play="第1期$https://video.example/player/1#第2期$https://video.example/player/2$$$第1期$https://video.example/1.m3u8?sign=first#第2期$https://video.example/2.m3u8?sign=second"</script>',
    } as Response);
    const detail = await getDetailFromApi(
      { ...apiSite, detail: 'https://source.example.com' },
      '151407'
    );
    expect(detail.episodes).toEqual([
      'https://video.example/1.m3u8?sign=first',
      'https://video.example/2.m3u8?sign=second',
    ]);
  });

  it.each([
    ['思想验证区域 第二季', '思想验证区域第二季'],
    ['思想验证区域　第二季', '思想验证区域第二季'],
    ['思想 验证 区域 第二季', '思想验证区域第二季'],
    ['The Last of Us', 'The Last of Us'],
    ['三体 Three Body', '三体 Three Body'],
  ])(
    'uses consistent downstream search terms for %s on every page',
    async (query, expected) => {
      await searchFromApi(apiSite, query, { maxSearchPages: 2 });
      const urls = jest
        .mocked(global.fetch)
        .mock.calls.map(([input]) => new URL(String(input)));
      expect(urls.map((url) => url.searchParams.get('wd'))).toEqual([
        expected,
        expected,
      ]);
    }
  );
});
