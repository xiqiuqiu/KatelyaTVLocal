import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import AppShell from '@/components/ui/AppShell';

jest.mock(
  '@/components/TopSearchBar',
  () =>
    ({
      isSidebarCollapsed,
      onToggleSidebar,
    }: {
      isSidebarCollapsed?: boolean;
      onToggleSidebar?: () => void;
    }) =>
      (
        <button
          data-testid='top-search-bar'
          aria-pressed={!isSidebarCollapsed}
          onClick={onToggleSidebar}
        />
      )
);
jest.mock(
  '@/components/Sidebar',
  () =>
    ({ collapsed }: { collapsed?: boolean }) =>
      <div data-testid='desktop-sidebar' data-collapsed={String(collapsed)} />
);
jest.mock('@/components/MobileBottomNav', () => () => (
  <div data-testid='mobile-bottom-nav' />
));

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__sidebarCollapsed;
    window.history.replaceState({}, '', '/');
    document.cookie = 'katelya_tv_mode=; Path=/; Max-Age=0';
  });

  it('remembers explicit Web mode and clears the override on re-entering TV mode', () => {
    window.history.replaceState({}, '', '/search?tv=0');
    const view = render(<AppShell activePath='/search'>search</AppShell>);
    expect(document.cookie).toContain('katelya_tv_mode=web');
    window.history.replaceState({}, '', '/search?tv=1');
    view.rerender(
      <AppShell activePath='/search' tvMode>
        search
      </AppShell>
    );
    expect(document.cookie).not.toContain('katelya_tv_mode=web');
    expect(screen.getByRole('link', { name: '退出电视模式' })).toHaveAttribute(
      'href',
      '/search?tv=0'
    );
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

  it('locks overscroll only while the play page is active', async () => {
    const { rerender, unmount } = render(
      <AppShell activePath='/play'>
        <div>play-body</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(
        document.documentElement.classList.contains('play-overscroll-lock')
      ).toBe(true);
    });

    rerender(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(
        document.documentElement.classList.contains('play-overscroll-lock')
      ).toBe(false);
    });

    unmount();
    expect(
      document.documentElement.classList.contains('play-overscroll-lock')
    ).toBe(false);
  });
});
