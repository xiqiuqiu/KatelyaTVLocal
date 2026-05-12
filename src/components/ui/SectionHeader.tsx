import type { ReactNode } from 'react';

interface SectionHeaderProps {
  action?: ReactNode;
  className?: string;
  subtitle?: ReactNode;
  title: ReactNode;
}

export default function SectionHeader({
  action,
  className = '',
  subtitle,
  title,
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-end justify-between gap-3 ${className}`.trim()}
    >
      <div className='min-w-0'>
        <h2 className='text-lg font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-xl'>
          {title}
        </h2>
        {subtitle ? (
          <p className='mt-1 text-sm text-[rgb(var(--ui-text-muted))]'>
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className='shrink-0'>{action}</div> : null}
    </div>
  );
}
