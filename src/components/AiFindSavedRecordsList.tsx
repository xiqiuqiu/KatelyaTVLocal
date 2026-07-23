'use client';

import { Clock3, PlayCircle } from 'lucide-react';

import type { AiFindSavedRecordSummary } from '@/lib/types';

interface AiFindSavedRecordsListProps {
  savedRecords: AiFindSavedRecordSummary[];
  activeSavedRecordId: string | null;
  onSelectRecord: (recordId: string) => void | Promise<void>;
}

function formatSavedRecordTime(timestamp: number): string {
  if (!timestamp) return '';

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(new Date(timestamp)).replaceAll('/', '-');
}

function getSavedRecordInitials(query: string): string[] {
  const compact = query.replace(/\s/g, '');
  return [
    compact.slice(0, 2) || 'AI',
    compact.slice(2, 4) || '找片',
    compact.slice(4, 6) || '结果',
  ];
}

export default function AiFindSavedRecordsList({
  savedRecords,
  activeSavedRecordId,
  onSelectRecord,
}: AiFindSavedRecordsListProps) {
  if (savedRecords.length === 0) {
    return null;
  }

  return (
    <section className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-base font-semibold text-[rgb(var(--ui-text))]'>
          最近 AI 找片
        </h2>
        <span className='text-xs text-[rgb(var(--ui-text-muted))]'>
          点击记录可直接打开结果
        </span>
      </div>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5'>
        {savedRecords.slice(0, 8).map((record) => {
          const initials = getSavedRecordInitials(record.query);
          const isComplete = record.status === 'complete';

          return (
            <button
              aria-label={record.query}
              className={`group relative min-h-[9.25rem] overflow-hidden rounded-2xl border p-3 text-left transition-[border-color,background-color,transform] duration-150 ease ui-hover-lift hover:border-[rgb(var(--ui-success)/0.42)] hover:bg-white/[0.075] ${
                activeSavedRecordId === record.id
                  ? 'border-[rgb(var(--ui-success)/0.46)] bg-[rgb(var(--ui-success)/0.09)]'
                  : 'border-white/10 bg-white/[0.045]'
              }`}
              key={record.id}
              onClick={() => void onSelectRecord(record.id)}
              type='button'
            >
              <div className='absolute inset-0 bg-[linear-gradient(135deg,rgb(var(--ui-accent)/0.08),transparent_42%,rgb(var(--ui-success)/0.08))] opacity-70' />
              <div className='relative flex h-full gap-3'>
                <div className='relative h-[6.4rem] w-[4.6rem] shrink-0'>
                  {initials.map((label, index) => (
                    <div
                      className='absolute h-[5.7rem] w-[3.9rem] rounded-xl border border-white/10 bg-[linear-gradient(145deg,rgb(var(--ui-surface-strong)),rgb(var(--ui-bg-elevated)))] shadow-[0_14px_26px_rgb(0_0_0/0.34)]'
                      key={`${record.id}-${label}-${index}`}
                      style={{
                        left: `${index * 7}px`,
                        top: `${index * 6}px`,
                        transform: `rotate(${index * 4 - 5}deg)`,
                      }}
                    >
                      <div className='flex h-full items-end rounded-xl bg-[radial-gradient(circle_at_35%_18%,rgb(var(--ui-accent)/0.42),transparent_38%),linear-gradient(180deg,transparent,rgb(0_0_0/0.58))] p-2'>
                        <span className='line-clamp-2 text-xs font-semibold text-white'>
                          {label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className='flex min-w-0 flex-1 flex-col justify-between'>
                  <div className='space-y-2'>
                    <p className='line-clamp-2 text-sm font-semibold leading-5 text-[rgb(var(--ui-text))]'>
                      {record.query}
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                        isComplete
                          ? 'border-[rgb(var(--ui-success)/0.24)] bg-[rgb(var(--ui-success)/0.12)] text-[rgb(var(--ui-success))]'
                          : 'border-[rgb(var(--ui-accent)/0.26)] bg-[rgb(var(--ui-accent)/0.12)] text-[rgb(var(--ui-accent))]'
                      }`}
                    >
                      {isComplete ? '已完成' : '继续加载'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-2 text-xs text-[rgb(var(--ui-text-muted))]'>
                    <span className='flex items-center gap-1'>
                      <Clock3 className='h-3.5 w-3.5' />
                      {formatSavedRecordTime(record.updatedAt)}
                    </span>
                    <span className='flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[rgb(var(--ui-text))] transition group-hover:border-[rgb(var(--ui-success)/0.34)] group-hover:text-[rgb(var(--ui-success))]'>
                      <PlayCircle className='h-4 w-4' />
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
