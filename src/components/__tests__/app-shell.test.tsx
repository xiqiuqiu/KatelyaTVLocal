import { render, screen } from '@testing-library/react';

import AppShell from '@/components/ui/AppShell';

jest.mock('@/components/TopSearchBar', () => () => (
  <div data-testid='top-search-bar' />
));
jest.mock('@/components/Sidebar', () => () => (
  <div data-testid='desktop-sidebar' />
));
jest.mock('@/components/MobileBottomNav', () => () => (
  <div data-testid='mobile-bottom-nav' />
));

describe('AppShell', () => {
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
});
