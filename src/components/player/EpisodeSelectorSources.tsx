'use client';

import React from 'react';

import type { SourceAvailabilityItem } from '@/lib/source-availability/index';
import type { SearchResult } from '@/lib/types';
import {
  getSourceStatusDescription,
  getSourceStatusLabel,
} from '@/lib/utils';

interface EpisodeSelectorSourcesProps {
  sourceSearchLoading: boolean;
  sourceSearchError: string | null;
  availableSourcesCount: number;
  sourceAvailabilityList: SourceAvailabilityItem[];
  videoTitle?: string;
  onSourceClick: (source: SearchResult) => void;
  onSearchMismatchClick: () => void;
}

const stateActiveClass =
  'border-[rgb(var(--ui-accent))] bg-[rgba(var(--ui-accent),0.1)] text-[rgb(var(--ui-text))] shadow-[inset_0_1px_0_rgba(var(--ui-text),0.08),0_8px_20px_rgba(0,0,0,0.18)]';
const stateIdleClass =
  'border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))] hover:border-[rgba(var(--ui-accent),0.45)] hover:bg-[rgba(var(--ui-surface-strong),0.82)] hover:text-[rgb(var(--ui-text))]';
const stateMutedClass =
  'border-[rgb(var(--ui-border))] bg-[rgba(var(--ui-surface),0.7)] text-[rgb(var(--ui-text-muted))] opacity-60';
const currentChipClass =
  'rounded-full bg-[rgb(var(--ui-border))] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[rgb(var(--ui-text))] ring-1 ring-[rgba(var(--ui-text),0.1)]';
const metaChipClass =
  'rounded-full bg-[rgb(var(--ui-border))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--ui-text-muted))]';

function getStatusClassName(
  effectiveSourceStatus: SourceAvailabilityItem['effectiveStatus']
): string {
  if (!effectiveSourceStatus) {
    return 'bg-[rgb(var(--ui-border))] text-[rgb(var(--ui-text-muted))]';
  }

  switch (effectiveSourceStatus.kind) {
    case 'direct':
      return 'bg-[rgba(var(--ui-success),0.16)] text-[rgb(var(--ui-success))] ring-1 ring-[rgba(var(--ui-success),0.38)]';
    case 'proxy':
      return 'bg-[rgba(var(--ui-accent),0.16)] text-[rgb(var(--ui-accent))] ring-1 ring-[rgba(var(--ui-accent),0.38)]';
    case 'playable':
      return 'bg-[rgba(var(--ui-accent-warm),0.16)] text-[rgb(var(--ui-accent-warm))] ring-1 ring-[rgba(var(--ui-accent-warm),0.38)]';
    case 'unavailable':
      return 'bg-[rgba(var(--ui-critical),0.16)] text-[rgb(var(--ui-critical))] ring-1 ring-[rgba(var(--ui-critical),0.38)]';
    case 'probing':
      return 'bg-[rgba(var(--ui-accent-warm),0.16)] text-[rgb(var(--ui-accent-warm))] ring-1 ring-[rgba(var(--ui-accent-warm),0.38)]';
    default:
      return 'bg-[rgb(var(--ui-border))] text-[rgb(var(--ui-text-muted))]';
  }
}

const EpisodeSelectorSources: React.FC<EpisodeSelectorSourcesProps> = ({
  sourceSearchLoading,
  sourceSearchError,
  availableSourcesCount,
  sourceAvailabilityList,
  videoTitle,
  onSourceClick,
  onSearchMismatchClick,
}) => {
  return (
    <div className='mt-1 flex min-h-0 flex-1 flex-col'>
      {sourceSearchLoading && (
        <div className='flex items-center justify-center rounded-ui-md border border-white/10 bg-white/[0.035] py-8'>
          <div className='h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-b-[rgb(var(--ui-accent))]'></div>
          <span className='ml-3 text-sm text-[rgb(var(--ui-text-muted))]'>
            搜索中...
          </span>
        </div>
      )}

      {sourceSearchError && (
        <div className='flex items-center justify-center rounded-ui-md border border-red-400/20 bg-red-500/10 py-8'>
          <div className='text-center'>
            <div className='mb-2 text-2xl text-red-300'>⚠️</div>
            <p className='text-sm text-red-200'>{sourceSearchError}</p>
          </div>
        </div>
      )}

      {!sourceSearchLoading &&
        !sourceSearchError &&
        availableSourcesCount === 0 && (
          <div className='flex items-center justify-center rounded-ui-md border border-white/10 bg-white/[0.035] py-8'>
            <div className='text-center'>
              <div className='mb-2 text-2xl text-[rgb(var(--ui-text-muted))]'>
                📺
              </div>
              <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
                暂无可用的换源
              </p>
            </div>
          </div>
        )}

      {!sourceSearchLoading &&
        !sourceSearchError &&
        availableSourcesCount > 0 && (
          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='grid flex-1 grid-cols-1 gap-2 overflow-y-auto pb-3 pr-0.5 sm:grid-cols-2 2xl:grid-cols-1'>
              {sourceAvailabilityList.map((availability) => {
                const { source, sourceKey } = availability;
                const isCurrentSource = availability.isCurrent;
                const videoInfo = availability.measured;
                const effectiveSourceStatus = availability.effectiveStatus;
                const isClickable =
                  availability.manualSwitch.mode !== 'blocked';
                const statusLabel = effectiveSourceStatus
                  ? getSourceStatusLabel(effectiveSourceStatus)
                  : '待检测';
                const qualityLabel =
                  videoInfo &&
                  !videoInfo.hasError &&
                  videoInfo.quality !== '未知' &&
                  videoInfo.quality !== '错误'
                    ? videoInfo.quality
                    : null;

                const statusClassName = getStatusClassName(
                  effectiveSourceStatus
                );

                const sourceStatusText = availability.episode.exists
                  ? getSourceStatusDescription(
                      effectiveSourceStatus,
                      videoInfo
                    )
                  : availability.manualSwitch.reason;

                return (
                  <button
                    key={sourceKey}
                    type='button'
                    disabled={!isClickable}
                    aria-current={isCurrentSource ? 'true' : undefined}
                    aria-label={`${
                      isCurrentSource ? '当前线路' : '切换线路'
                    } ${source.source_name}`}
                    title={`${source.title} · ${sourceStatusText}`}
                    onClick={() => isClickable && onSourceClick(source)}
                    className={`group relative min-w-0 rounded-ui-md border px-3 py-3 text-left transition-[border-color,background-color,color] duration-200
                          ${
                            isCurrentSource
                              ? `${stateActiveClass} cursor-default disabled:opacity-100`
                              : isClickable
                              ? stateIdleClass
                              : `${stateMutedClass} cursor-not-allowed`
                          }`.trim()}
                  >
                    <div className='flex min-w-0 items-start justify-between gap-2'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-sm font-semibold text-[rgb(var(--ui-text))]'>
                            {source.source_name}
                          </span>
                          {isCurrentSource && (
                            <span className={currentChipClass}>当前</span>
                          )}
                        </div>
                        <p className='mt-1 truncate text-[11px] text-[rgb(var(--ui-text-muted))]'>
                          {source.title}
                        </p>
                      </div>
                      <span
                        className={`${statusClassName} shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <div className='mt-3 flex flex-wrap items-center gap-1.5'>
                      {qualityLabel && (
                        <span className='rounded-full bg-[rgba(var(--ui-success),0.16)] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--ui-success))] ring-1 ring-[rgba(var(--ui-success),0.38)]'>
                          {qualityLabel}
                        </span>
                      )}
                      {source.episodes.length > 1 && (
                        <span className={metaChipClass}>
                          {source.episodes.length} 集
                        </span>
                      )}
                      <span className={metaChipClass}>
                        {isClickable ? '可切换' : '不可切换'}
                      </span>
                    </div>

                    <p className='mt-2 truncate text-[11px] font-medium text-[rgb(var(--ui-text-muted))]'>
                      {sourceStatusText}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className='flex-shrink-0 border-t border-white/10 pt-2'>
              <button
                onClick={() => {
                  if (videoTitle) {
                    onSearchMismatchClick();
                  }
                }}
                className='w-full rounded-ui-sm px-3 py-2 text-center text-xs font-medium text-[rgb(var(--ui-text-muted))] transition-colors hover:bg-white/[0.06] hover:text-[rgb(var(--ui-text))]'
                type='button'
              >
                影片匹配有误？点击去搜索
              </button>
            </div>
          </div>
        )}
    </div>
  );
};

export default EpisodeSelectorSources;
