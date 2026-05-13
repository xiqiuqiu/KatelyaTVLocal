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
    <div className='flex items-start justify-between gap-3 rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.56)] p-5 shadow-ui-soft backdrop-blur-xl sm:gap-4'>
      <div className='min-w-0 flex-1'>
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
        <div className='flex shrink-0 items-start gap-2'>{actions}</div>
      ) : null}
    </div>
  );
}
