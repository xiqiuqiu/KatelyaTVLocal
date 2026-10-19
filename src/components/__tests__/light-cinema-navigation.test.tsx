import { fireEvent, render, screen, within } from '@testing-library/react';

import MobileBottomNav from '@/components/MobileBottomNav';
import TopSearchBar from '@/components/TopSearchBar';

const push = jest.fn();
let mockPathname = '/';
let mockParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockParams,
  useRouter: () => ({ push }),
}));
jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button>切换外观</button>,
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

describe('Light Cinema navigation', () => {
  beforeEach(() => {
    mockPathname = '/';
    mockParams = new URLSearchParams();
    push.mockReset();
  });

  it('keeps four mobile destinations and exposes personal content through one menu', () => {
    const open = jest.fn();
    render(<MobileBottomNav activePath='/?tab=favorites' onOpenMenu={open} />);
    const nav = screen.getByRole('navigation', { name: '手机导航' });
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: '发现' })).toHaveAttribute(
      'href',
      '/douban'
    );
    expect(within(nav).getByRole('link', { name: '首页' })).toHaveAttribute(
      'data-active',
      'false'
    );
    const mine = within(nav).getByRole('button', { name: '我的' });
    expect(mine).toHaveAttribute('data-active', 'true');
    fireEvent.click(mine);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('preserves search context when entering TV mode from the shared header', () => {
    mockPathname = '/search';
    mockParams = new URLSearchParams('q=庆余年&mode=ai&tv=0');
    render(<TopSearchBar />);
    const href = screen
      .getByRole('link', { name: '进入电视模式' })
      .getAttribute('href');
    const target = new URL(href || '', 'https://tv.local');
    expect(target.pathname).toBe('/search');
    expect(target.searchParams.get('q')).toBe('庆余年');
    expect(target.searchParams.get('mode')).toBe('ai');
    expect(target.searchParams.get('tv')).toBe('1');

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: ' 三体 ' },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(push).toHaveBeenCalledWith('/search?q=%E4%B8%89%E4%BD%93');
  });
});
