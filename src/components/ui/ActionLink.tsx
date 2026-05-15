import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

interface ActionLinkProps {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const baseClassName =
  'inline-flex items-center gap-1 rounded-full border border-[rgb(var(--ui-border)/0.28)] bg-[rgb(var(--ui-surface)/0.2)] px-3 py-1.5 text-sm font-medium text-[rgb(var(--ui-text-muted))] backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-[rgb(var(--ui-accent)/0.34)] hover:bg-[rgb(var(--ui-surface-strong)/0.36)] hover:text-[rgb(var(--ui-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

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
