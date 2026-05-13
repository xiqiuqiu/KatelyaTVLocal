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
});
