import type { ReactNode } from 'react';

interface PlayerHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PlayerHeader({
  title,
  subtitle,
  actions,
}: PlayerHeaderProps) {
  return (
    <div className='ui-player-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0 flex-1'>
        <h1 className='break-words text-2xl font-semibold text-[rgb(var(--ui-text))] md:text-3xl'>
          {title}
        </h1>
        {subtitle ? (
          <p className='mt-2 text-sm text-[rgb(var(--ui-text-muted))]'>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className='ui-player-header-actions flex shrink-0 flex-wrap items-center gap-2'>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
