import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSitesFromConfig: () => [
    { key: 'line', api: 'https://media.example.com' },
  ],
  getSearchDownstreamMaxPageFromConfig: () => 5,
}));

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: jest.fn(),
  searchFromApi: jest.fn(),
}));

const detail = {
  id: '123',
  source: 'line',
  source_name: 'Line',
  title: 'Example',
  poster: '',
  year: '2026',
  episodes: ['https://media.example.com/episode.m3u8'],
};
const request = { source: 'line', id: detail.id, fallbackTitle: detail.title };

describe('fetchVideoDetail', () => {
  beforeEach(() => jest.resetAllMocks());

  it('uses the known source and ID without searching when detail is playable', async () => {
    jest.mocked(getDetailFromApi).mockResolvedValue(detail);
    await expect(fetchVideoDetail(request)).resolves.toBe(detail);
    expect(getDetailFromApi).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'line' }),
      '123',
      undefined
    );
    expect(searchFromApi).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'searches one page after unusable detail (request failed: %s)',
    async (failed) => {
      if (failed) {
        jest
          .mocked(getDetailFromApi)
          .mockRejectedValue(new Error('detail failed'));
      } else {
        jest
          .mocked(getDetailFromApi)
          .mockResolvedValue({ ...detail, episodes: [] });
      }
      jest
        .mocked(searchFromApi)
        .mockResolvedValue([{ ...detail, id: 'another-id' }, detail]);
      await expect(fetchVideoDetail(request)).resolves.toBe(detail);
      expect(searchFromApi).toHaveBeenCalledTimes(1);
      expect(searchFromApi).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'line' }),
        detail.title,
        { maxSearchPages: 1 }
      );
    }
  );

  it('bounds a refresh to one detail and one search without following redirects', async () => {
    jest.mocked(getDetailFromApi).mockRejectedValue(new Error('redirect'));
    jest.mocked(searchFromApi).mockResolvedValue([detail]);
    await expect(
      fetchVideoDetail({ ...request, redirect: 'error' })
    ).resolves.toBe(detail);
    expect(getDetailFromApi).toHaveBeenCalledWith(
      expect.anything(),
      '123',
      'error'
    );
    expect(searchFromApi).toHaveBeenCalledWith(
      expect.anything(),
      request.fallbackTitle,
      { maxSearchPages: 1, redirect: 'error' }
    );
  });

  it('keeps the detail error when the fallback only finds another resource', async () => {
    const error = new Error('detail failed');
    jest.mocked(getDetailFromApi).mockRejectedValue(error);
    jest
      .mocked(searchFromApi)
      .mockResolvedValue([{ ...detail, id: 'another-id' }]);
    await expect(fetchVideoDetail(request)).rejects.toBe(error);
  });
});
