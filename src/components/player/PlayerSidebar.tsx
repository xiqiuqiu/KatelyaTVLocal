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
      className={`ui-player-sidebar rounded-ui-md bg-[rgb(var(--ui-surface))] p-4 sm:p-5 ${className}`.trim()}
    >
      {children}
    </aside>
  );
}
