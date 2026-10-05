import AppShell from '@/components/ui/AppShell';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  tvMode?: boolean;
  modeHref?: string;
}

const PageLayout = ({
  children,
  activePath = '/',
  tvMode = false,
  modeHref,
}: PageLayoutProps) => (
  <AppShell activePath={activePath} tvMode={tvMode} modeHref={modeHref}>
    {children}
  </AppShell>
);

export default PageLayout;
