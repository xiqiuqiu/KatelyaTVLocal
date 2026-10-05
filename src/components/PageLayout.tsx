import AppShell from '@/components/ui/AppShell';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  tvMode?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  tvMode = false,
}: PageLayoutProps) => (
  <AppShell activePath={activePath} tvMode={tvMode}>
    {children}
  </AppShell>
);

export default PageLayout;
