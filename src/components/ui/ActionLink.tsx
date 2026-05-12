import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

interface ActionLinkProps {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const baseClassName =
  'inline-flex items-center gap-1 rounded-full px-1 py-1 text-sm font-medium text-[rgb(var(--ui-text-muted))] transition hover:text-[rgb(var(--ui-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

export default function ActionLink({
  children,
  className = '',
  href,
  onClick,
}: ActionLinkProps) {
  const resolvedClassName = `${baseClassName} ${className}`.trim();

  if (href) {
    return (
      <Link className={resolvedClassName} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button
      className={resolvedClassName}
      onClick={onClick}
      type='button'
    >
      {children}
    </button>
  );
}
