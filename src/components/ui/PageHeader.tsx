import type { ReactNode } from 'react';

interface PageHeaderProps {
  action?: ReactNode;
  className?: string;
  subtitle?: ReactNode;
  title: ReactNode;
}

export default function PageHeader({
  action,
  className = '',
  subtitle,
  title,
}: PageHeaderProps) {
  return (
    <div
      className={`ui-page-hero flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`.trim()}
    >
      <div className='min-w-0'>
        <h1 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
          {title}
        </h1>
        {subtitle ? (
          <p className='mt-2 max-w-3xl text-sm leading-6 text-[rgb(var(--ui-text-muted))] sm:text-base'>
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className='shrink-0'>{action}</div> : null}
    </div>
  );
}
