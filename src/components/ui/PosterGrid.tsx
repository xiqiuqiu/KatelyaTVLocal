import type { ReactNode } from 'react';

interface PosterGridProps {
  children: ReactNode;
  className?: string;
}

export default function PosterGrid({
  children,
  className = '',
}: PosterGridProps) {
  return (
    <div
      className={`ui-poster-grid grid grid-cols-2 gap-4 min-[440px]:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
