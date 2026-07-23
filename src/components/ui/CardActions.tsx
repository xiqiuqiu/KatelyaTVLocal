import type { ReactNode } from 'react';

interface CardActionsProps {
  children: ReactNode;
  className?: string;
}

export default function CardActions({
  children,
  className = '',
}: CardActionsProps) {
  return (
    <div
      className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 opacity-0 transition-opacity duration-150 ease max-md:opacity-100 group-hover:opacity-100 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
