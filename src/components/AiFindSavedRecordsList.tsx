'use client';

import { Clock3, PlayCircle } from 'lucide-react';

import type { AiFindSavedRecordSummary } from '@/lib/types';

interface AiFindSavedRecordsListProps {
  tvMode?: boolean;
  disabled?: boolean;
  savedRecords: AiFindSavedRecordSummary[];
  activeSavedRecordId: string | null;
  onSelectRecord: (recordId: string) => void | Promise<void>;
}

const savedRecordTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatSavedRecordTime(timestamp: number): string {
  if (!timestamp) return '';

  return savedRecordTimeFormatter
    .format(new Date(timestamp))
    .replaceAll('/', '-');
}

export default function AiFindSavedRecordsList({
  tvMode = false,
  disabled = false,
  savedRecords,
  activeSavedRecordId,
  onSelectRecord,
}: AiFindSavedRecordsListProps) {
  const heading = (
    <h2
      className={
        tvMode
          ? 'ui-saved-heading text-2xl font-semibold'
          : 'text-lg font-semibold'
      }
    >
      最近 AI 找片
    </h2>
  );

  if (savedRecords.length === 0) {
    // 空态也要可见：说明功能存在、结果会保存在这里（本地无历史时同样展示）
    return (
      <section className='space-y-4'>
        {heading}
        <div className='ui-saved-empty'>
          <Clock3 aria-hidden className='h-5 w-5 shrink-0' />
          <div>
            <p className='ui-saved-empty-title'>还没有 AI 找片记录</p>
            <p className='ui-saved-empty-desc'>
              用一句话描述想看的影片，结果会自动保存在这里，之后可直接打开
              {tvMode ? '；用方向键选择记录，按确认键打开。' : '，无需重新请求 AI。'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className='space-y-4'>
      {heading}
      <p className='ui-saved-desc text-sm text-[rgb(var(--ui-text-muted))]'>
        {disabled
          ? '本次查询完成后可打开历史记录。'
          : '选择记录直接打开保存的结果，不重新请求 AI。'}
      </p>
      <div className='grid gap-3 lg:grid-cols-2'>
        {savedRecords.slice(0, 8).map((record) => (
          <button
            key={record.id}
            type='button'
            disabled={disabled}
            aria-label={record.query}
            aria-pressed={activeSavedRecordId === record.id}
            data-tv-focus-key={`ai-record:${record.id}`}
            onClick={() => void onSelectRecord(record.id)}
            className='ui-saved-query'
          >
            <Clock3
              aria-hidden
              className='h-5 w-5 shrink-0 text-[rgb(var(--ui-text-muted))]'
            />
            <span className='min-w-0 flex-1'>
              <span className='line-clamp-2 block text-base font-semibold'>
                {record.query}
              </span>
              <span className='mt-1 block text-sm text-[rgb(var(--ui-text-muted))]'>
                {record.foundGroupCount} 组结果 ·{' '}
                {record.status === 'complete' ? '已完成' : '部分结果'} ·{' '}
                {formatSavedRecordTime(record.updatedAt)}
              </span>
            </span>
            <PlayCircle aria-hidden className='h-5 w-5 shrink-0' />
          </button>
        ))}
      </div>
    </section>
  );
}
