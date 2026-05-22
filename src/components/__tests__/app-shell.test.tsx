import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import AppShell from '@/components/ui/AppShell';

jest.mock('@/components/TopSearchBar', () => ({
  isSidebarCollapsed,
  onToggleSidebar,
}: {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) => (
  <button
    data-testid='top-search-bar'
    aria-pressed={!isSidebarCollapsed}
    onClick={onToggleSidebar}
  />
));
jest.mock('@/components/Sidebar', () => ({
  collapsed,
}: {
  collapsed?: boolean;
}) => (
  <div
    data-testid='desktop-sidebar'
    data-collapsed={String(collapsed)}
  />
));
jest.mock('@/components/MobileBottomNav', () => () => (
  <div data-testid='mobile-bottom-nav' />
));

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__sidebarCollapsed;
  });

  it('renders the shared shell regions around page content', () => {
    render(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    expect(screen.getByTestId('top-search-bar')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument();
    expect(screen.getByText('search-body')).toBeInTheDocument();
  });

  it('renders the server shell with the collapsed default even when a saved expanded state exists', () => {
    window.localStorage.setItem('sidebarCollapsed', 'false');

    const html = renderToString(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    expect(html).toContain('aria-pressed="false"');
  });

  it('restores saved sidebar state after the shell mounts in the browser', async () => {
    window.localStorage.setItem('sidebarCollapsed', 'false');

    render(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(screen.getByTestId('top-search-bar')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  });

  it('persists sidebar toggles after hydration', () => {
    render(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    fireEvent.click(screen.getByTestId('top-search-bar'));

    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('false');
    expect(window.__sidebarCollapsed).toBe(false);
  });
});
