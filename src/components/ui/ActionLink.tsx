import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

interface ActionLinkProps {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const baseClassName =
  'ui-action-link inline-flex min-h-11 items-center justify-center gap-1 rounded-ui-sm px-3 py-2 text-sm font-medium text-[rgb(var(--ui-text-muted))] transition-colors duration-150 hover:bg-[rgb(var(--ui-surface-strong))] hover:text-[rgb(var(--ui-text))]';

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
    <button className={resolvedClassName} onClick={onClick} type='button'>
      {children}
    </button>
  );
}
