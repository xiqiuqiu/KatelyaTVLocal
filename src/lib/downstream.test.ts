import type { ApiSite } from './config';

const getConfig = jest.fn();

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
  getConfig,
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { searchFromApi } = require('./downstream');

    await searchFromApi(apiSite, '示例', { maxSearchPages: 2 });

    expect(getConfig).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('pg=2');
  });
});
