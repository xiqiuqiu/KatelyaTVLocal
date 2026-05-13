import type { ReactNode } from 'react';

interface PlayerSidebarProps {
  children: ReactNode;
  className?: string;
}

export default function PlayerSidebar({
  children,
  className = '',
}: PlayerSidebarProps) {
  return (
    <aside
      className={`rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.58)] p-4 shadow-ui-soft backdrop-blur-xl ${className}`.trim()}
    >
      {children}
    </aside>
  );
}
