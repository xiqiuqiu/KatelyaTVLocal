import type { ReactNode } from 'react';

interface PosterGridProps {
  children: ReactNode;
  className?: string;
}

export default function PosterGrid({
  children,
  className = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
}: PosterGridProps) {
  return (
    <div className={`ui-poster-grid grid gap-4 ${className}`.trim()}>
      {children}
    </div>
  );
}
