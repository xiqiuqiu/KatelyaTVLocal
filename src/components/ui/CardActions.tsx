import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

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
      className={twMerge(
        'absolute bottom-3 right-3 z-20 flex items-center gap-2 opacity-0 transition-opacity duration-150 max-md:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
        className
      )}
    >
      {children}
    </div>
  );
}
