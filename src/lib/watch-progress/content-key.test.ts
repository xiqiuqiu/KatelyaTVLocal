import { buildWatchProgressContentKey } from './content-key';

describe('buildWatchProgressContentKey', () => {
  it('builds a stable key from normalized title and year', () => {
    expect(
      buildWatchProgressContentKey({
        title: '  测试 影片  ',
        year: '2026',
      })
    ).toBe('测试影片::2026');
  });

  it('uses a single missing-year downgrade sentinel', () => {
    expect(
      buildWatchProgressContentKey({
        title: '测试影片',
        year: '',
      })
    ).toBe('测试影片::unknown');

    expect(
      buildWatchProgressContentKey({
        title: '测试影片',
        year: undefined,
      })
    ).toBe('测试影片::unknown');

    expect(
      buildWatchProgressContentKey({
        title: '测试影片',
        year: 'unknown',
      })
    ).toBe('测试影片::unknown');
  });

  it('treats non-numeric years as missing', () => {
    expect(
      buildWatchProgressContentKey({
        title: '测试影片',
        year: 'N/A',
      })
    ).toBe('测试影片::unknown');
  });
});
