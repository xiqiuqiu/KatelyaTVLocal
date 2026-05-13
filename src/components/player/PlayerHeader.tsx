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
    <div className='flex flex-col gap-4 rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.56)] p-5 shadow-ui-soft backdrop-blur-xl lg:flex-row lg:items-start lg:justify-between'>
      <div className='min-w-0'>
        <p className='mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--ui-accent-warm))]'>
          正在播放
        </p>
        <h1 className='truncate text-2xl font-semibold text-[rgb(var(--ui-text))] md:text-3xl'>
          {title}
        </h1>
        {subtitle ? (
          <p className='mt-2 text-sm text-[rgb(var(--ui-text-muted))]'>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className='flex flex-wrap items-center gap-2'>{actions}</div>
      ) : null}
    </div>
  );
}
