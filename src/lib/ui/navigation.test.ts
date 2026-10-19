import { isNavigationItemActive } from './navigation';

describe('navigation destinations', () => {
  it.each([
    ['/?tv=1', '/', true],
    ['/?tab=favorites&tv=1', '/', false],
    ['/?tab=favorites&tv=1', '/?tab=favorites', true],
    ['/douban?type=tv', '/douban', true],
    ['/douban?type=tv_domestic', '/douban?type=tv', false],
    [
      '/douban?type=movie&tag=%E5%8D%8E%E8%AF%AD',
      '/douban?type=movie&tag=%E5%8D%8E%E8%AF%AD',
      true,
    ],
    ['/search?q=%E5%BA%86%E4%BD%99%E5%B9%B4&tv=1', '/search', true],
    ['/history?tv=1', '/history', true],
  ])('matches %s against %s as %s', (current, target, active) => {
    expect(isNavigationItemActive(current, target)).toBe(active);
  });
});
