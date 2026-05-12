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
      className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:translate-y-0 group-hover:opacity-100 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
