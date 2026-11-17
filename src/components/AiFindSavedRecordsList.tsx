'use client';

import { Clock3, PlayCircle } from 'lucide-react';
import { Fragment } from 'react';

import type { AiFindSavedRecordSummary } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

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

/** 叠层封面上的三段短文案：取查询词前 6 个字，不足则给默认文案。 */
function getSavedRecordInitials(query: string): string[] {
  const compact = query.replace(/\s/g, '');
  return [
    compact.slice(0, 2) || 'AI',
    compact.slice(2, 4) || '找片',
    compact.slice(4, 6) || '结果',
  ];
}

export default function AiFindSavedRecordsList({
  tvMode = false,
  disabled = false,
  savedRecords,
  activeSavedRecordId,
  onSelectRecord,
}: AiFindSavedRecordsListProps) {
  if (savedRecords.length === 0) {
    // 空态也要可见：说明功能存在、结果会保存在这里（本地无历史时同样展示）
    return (
      <section className='space-y-4'>
        <h2
          className={
            tvMode ? 'text-2xl font-semibold' : 'text-lg font-semibold'
          }
        >
          最近 AI 找片
        </h2>
        <div className='ui-saved-empty'>
          <Clock3 aria-hidden className='h-5 w-5 shrink-0' />
          <div>
            <p className='ui-saved-empty-title'>还没有 AI 找片记录</p>
            <p className='ui-saved-empty-desc'>
              {tvMode
                ? '用一句话描述想看的影片，结果会自动保存在这里；用方向键选择记录，按确认键打开。'
                : '用一句话描述想看的影片，结果会自动保存在这里，之后可直接打开，无需重新请求 AI。'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className='ui-saved-section'>
      <div className='ui-saved-header'>
        <h2
          className={
            tvMode
              ? 'ui-saved-heading text-2xl font-semibold'
              : 'text-lg font-semibold'
          }
        >
          最近 AI 找片
        </h2>
        <span className='ui-saved-hint'>
          {disabled ? '本次查询完成后可打开历史记录' : '点击记录可直接打开结果'}
        </span>
      </div>

      <div className='ui-saved-grid'>
        {savedRecords.slice(0, 8).map((record) => {
          const initials = getSavedRecordInitials(record.query);
          const posters = record.posters ?? [];
          const isComplete = record.status === 'complete';
          const isActive = activeSavedRecordId === record.id;

          return (
            <button
              key={record.id}
              type='button'
              disabled={disabled}
              aria-label={record.query}
              aria-pressed={isActive}
              data-tv-focus-key={`ai-record:${record.id}`}
              onClick={() => void onSelectRecord(record.id)}
              className='ui-saved-card'
            >
              <span className='ui-saved-card-glow' aria-hidden='true' />
              <span className='ui-saved-card-body'>
                <span className='ui-saved-stack' aria-hidden='true'>
                  {initials.map((label, index) => {
                    const poster = posters[index];
                    return (
                      <Fragment key={`${record.id}-${index}`}>
                        <span
                          className='ui-saved-stack-card'
                          data-has-poster={poster ? 'true' : undefined}
                          style={{
                            left: `${index * 7}px`,
                            top: `${index * 6}px`,
                            transform: `rotate(${index * 4 - 5}deg)`,
                            // 第一张（首个结果）压在最上层，后面的依次露出边缘
                            zIndex: initials.length - index,
                          }}
                        >
                          {poster ? (
                            // 海报走 image-proxy，尺寸很小，无需 next/image 优化
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt=''
                              aria-hidden='true'
                              className='ui-saved-stack-poster'
                              loading='lazy'
                              referrerPolicy='no-referrer'
                              src={processImageUrl(poster, {
                                width: 160,
                                height: 240,
                                quality: 70,
                              })}
                            />
                          ) : (
                            <span className='ui-saved-stack-label'>
                              {label}
                            </span>
                          )}
                        </span>
                      </Fragment>
                    );
                  })}
                </span>

                <span className='ui-saved-card-main'>
                  <span className='ui-saved-card-top'>
                    <span className='ui-saved-query-title'>{record.query}</span>
                    <span
                      className='ui-saved-status'
                      data-status={isComplete ? 'complete' : 'partial'}
                    >
                      {isComplete ? '已完成' : '继续加载'}
                    </span>
                  </span>
                  <span className='ui-saved-card-foot'>
                    <span className='ui-saved-time'>
                      <Clock3 aria-hidden className='h-3.5 w-3.5' />
                      {formatSavedRecordTime(record.updatedAt)}
                    </span>
                    <span className='ui-saved-open' aria-hidden='true'>
                      <PlayCircle className='h-4 w-4' />
                    </span>
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
