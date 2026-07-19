'use client';

import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import type {
  AiFindCandidateQuery,
  AiFindResponse,
} from '@/lib/ai-find/types';

import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import Surface from '@/components/ui/Surface';
import VideoCard from '@/components/VideoCard';

type GroupLoadErrors = Record<string, string>;

interface AiFindResultGroupsProps {
  result: AiFindResponse;
  loadingGroups: string[];
  groupErrors: GroupLoadErrors;
  activeSavedRecordId: string | null;
  hasResults: boolean;
  hasPendingGroups: boolean;
  onRefresh: () => void;
  onDeleteRecord: () => void | Promise<void>;
  onSuggestionClick: (suggestion: string) => void;
}

function getConfidenceLabel(confidence: AiFindCandidateQuery['confidence']) {
  if (confidence === 'high') return '高匹配';
  if (confidence === 'medium') return '可参考';
  return '待确认';
}

export default function AiFindResultGroups({
  result,
  loadingGroups,
  groupErrors,
  activeSavedRecordId,
  hasResults,
  hasPendingGroups,
  onRefresh,
  onDeleteRecord,
  onSuggestionClick,
}: AiFindResultGroupsProps) {
  return (
    <div className='space-y-7'>
      <Surface className='p-4 sm:p-5' variant='plain'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
          <div className='min-w-0 space-y-3'>
            <div className='flex items-start gap-3'>
              <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--ui-success))]' />
              <div>
                <h2 className='text-lg font-semibold text-[rgb(var(--ui-text))]'>
                  根据你的需求，我为你找到了以下影片
                </h2>
                <p className='mt-1 text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
                  {result.answer}
                </p>
              </div>
            </div>
          </div>
          {activeSavedRecordId ? (
            <div className='flex shrink-0 flex-wrap gap-2'>
              <button
                className='inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-[rgb(var(--ui-text))] transition hover:border-[rgb(var(--ui-accent)/0.34)] hover:bg-white/10'
                onClick={onRefresh}
                type='button'
              >
                <RefreshCw className='h-4 w-4' />
                刷新结果
              </button>
              <button
                className='inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-[rgb(var(--ui-text-muted))] transition hover:border-[rgb(var(--ui-critical)/0.34)] hover:bg-[rgb(var(--ui-critical)/0.08)] hover:text-[rgb(var(--ui-critical))]'
                onClick={() => void onDeleteRecord()}
                type='button'
              >
                <Trash2 className='h-4 w-4' />
                删除记录
              </button>
            </div>
          ) : null}
        </div>
        <div className='mt-4 space-y-3'>
          {result.degraded && result.errorMessage ? (
            <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
              已降级处理：{result.errorMessage}
            </p>
          ) : null}
          {result.candidateQueries.length > 0 ? (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-[rgb(var(--ui-text-muted))]'>
                候选影片：
              </span>
              {result.candidateQueries.map((candidate, index) => (
                <span
                  className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-[rgb(var(--ui-text))]'
                  key={`${candidate.query}-${candidate.reason}`}
                >
                  <span className='flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--ui-success)/0.18)] px-1 text-[11px] font-semibold text-[rgb(var(--ui-success))]'>
                    {index + 1}
                  </span>
                  {candidate.query}
                  <span className='hidden text-[rgb(var(--ui-text-muted))] sm:inline'>
                    {getConfidenceLabel(candidate.confidence)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Surface>

      {result.groups.map((group) => (
        <section className='space-y-4' key={group.query}>
          <SectionHeader
            subtitle={
              group.notFound
                ? group.reason
                : `${group.reason}，找到 ${group.groupedCount} 组聚合结果`
            }
            title={group.query}
          />

          {group.groups.length > 0 ? (
            <PosterGrid className='grid-cols-3 justify-start gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'>
              {group.groups.map((item) => (
                <div className='w-full' key={item.groupKey}>
                  <VideoCard
                    from='search'
                    items={item.items}
                    query={
                      group.query.trim() !== item.title
                        ? group.query.trim()
                        : ''
                    }
                  />
                </div>
              ))}
            </PosterGrid>
          ) : loadingGroups.includes(group.query) ? (
            <Surface
              className='flex items-center justify-center gap-2 px-6 py-8 text-center text-sm text-[rgb(var(--ui-text-muted))]'
              variant='plain'
            >
              <Loader2 className='h-4 w-4 animate-spin' />
              <span>正在查询这个候选片名的资源站结果</span>
            </Surface>
          ) : groupErrors[group.query] ? (
            <Surface
              className='px-6 py-8 text-center text-sm text-[rgb(var(--ui-text-muted))]'
              variant='plain'
            >
              {groupErrors[group.query]}
            </Surface>
          ) : (
            <Surface
              className='px-6 py-8 text-center text-sm text-[rgb(var(--ui-text-muted))]'
              variant='plain'
            >
              当前资源站没有找到这个候选片名
            </Surface>
          )}
        </section>
      ))}

      {!hasResults && !hasPendingGroups && result.suggestions.length > 0 ? (
        <Surface className='p-4 sm:p-5' variant='plain'>
          <div className='space-y-3'>
            <div className='text-sm text-[rgb(var(--ui-text-muted))]'>
              可以尝试这些关键词：
            </div>
            <div className='flex flex-wrap gap-2'>
              {result.suggestions.map((suggestion) => (
                <button
                  className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[rgb(var(--ui-text))] transition hover:bg-white/10'
                  key={suggestion}
                  onClick={() => onSuggestionClick(suggestion)}
                  type='button'
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}
