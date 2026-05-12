import AppShell from '@/components/ui/AppShell';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => (
  <AppShell activePath={activePath}>{children}</AppShell>
);

export default PageLayout;
