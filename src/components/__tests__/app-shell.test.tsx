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

jest.mock('@/components/UserMenu', () => ({ UserMenu: () => null }));

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

  it('keeps all discovery categories and mode context reachable on TV', () => {
    render(
      <AppShell
        activePath='/douban?type=tv'
        tvMode
        modeHref='/douban?type=tv&tv=1'
      >
        剧集
      </AppShell>
    );
    expect(screen.getByRole('link', { name: '发现' })).toHaveAttribute(
      'href',
      '/douban?type=movie&tv=1'
    );
    expect(screen.getByRole('link', { name: '综艺' })).toHaveAttribute(
      'href',
      '/douban?type=show&tv=1'
    );
    expect(screen.getByRole('link', { name: '剧集' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: '退出电视模式' })).toHaveAttribute(
      'href',
      '/douban?type=tv&tv=0'
    );
    expect(
      screen.queryByRole('link', { name: '管理面板' })
    ).not.toBeInTheDocument();
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

  it('renders the server shell with readable navigation before restoring a saved compact preference', () => {
    window.localStorage.setItem('sidebarCollapsed', 'true');

    const html = renderToString(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    expect(html).toContain('aria-pressed="true"');
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

    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('true');
    expect(window.__sidebarCollapsed).toBe(true);
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
