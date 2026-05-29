import { fireEvent, render, screen } from '@testing-library/react';

import Sidebar from '@/components/Sidebar';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

describe('Sidebar shell density', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__sidebarCollapsed;
    document.documentElement.removeAttribute('data-sidebar-collapsed');
  });

  it('defaults the desktop sidebar to the compact icon rail', () => {
    render(<Sidebar activePath='/' />);

    expect(screen.getByTestId('desktop-sidebar')).toHaveAttribute(
      'data-collapsed',
      'true'
    );
    expect(screen.queryByText('首页')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('preserves the existing expand and collapse interaction', () => {
    render(<Sidebar activePath='/' />);

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));

    expect(screen.getByTestId('desktop-sidebar')).toHaveAttribute(
      'data-collapsed',
      'false'
    );
    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('false');
  });

  it('can hide the internal collapse button when the shell owns the control', () => {
    render(
      <Sidebar activePath='/' collapsed={true} showCollapseToggle={false} />
    );

    expect(screen.getByTestId('desktop-sidebar')).toHaveAttribute(
      'data-collapsed',
      'true'
    );
    expect(
      screen.queryByRole('button', { name: '展开侧边栏' })
    ).not.toBeInTheDocument();
  });

  it('shows favorites as a sidebar destination and marks it active', () => {
    render(<Sidebar activePath='/?tab=favorites' collapsed={false} />);

    const favoriteLink = screen.getByRole('link', { name: /收藏夹/ });

    expect(favoriteLink).toHaveAttribute('href', '/?tab=favorites');
    expect(favoriteLink).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: /首页/ })).toHaveAttribute(
      'data-active',
      'false'
    );
  });

  it('does not show unavailable TVBox configuration in the desktop sidebar', () => {
    render(<Sidebar activePath='/' collapsed={false} />);

    expect(
      screen.queryByRole('link', { name: /TVBox配置/ })
    ).not.toBeInTheDocument();
  });
});
