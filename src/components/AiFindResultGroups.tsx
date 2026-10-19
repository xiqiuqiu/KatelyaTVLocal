'use client';

import { CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import type { AiFindCandidateQuery, AiFindResponse } from '@/lib/ai-find/types';

import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import Surface from '@/components/ui/Surface';
import VideoCard from '@/components/VideoCard';

type GroupLoadErrors = Record<string, string>;

interface AiFindResultGroupsProps {
  tvMode?: boolean;
  actionsDisabled?: boolean;
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

function AiFindResultToolbar({
  actionsDisabled,
  activeSavedRecordId,
  onDeleteRecord,
  onRefresh,
  result,
  tvMode,
}: Pick<
  AiFindResultGroupsProps,
  | 'actionsDisabled'
  | 'activeSavedRecordId'
  | 'onDeleteRecord'
  | 'onRefresh'
  | 'result'
  | 'tvMode'
>) {
  return (
    <>
      <div
        className={
          tvMode
            ? 'flex flex-wrap items-center gap-6'
            : 'flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'
        }
      >
        <div className='min-w-0 space-y-3'>
          <div className='flex items-start gap-3'>
            <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--ui-success))]' />
            <div>
              <h2
                className={
                  tvMode
                    ? 'text-2xl font-semibold'
                    : 'text-lg font-semibold text-[rgb(var(--ui-text))]'
                }
              >
                {tvMode ? '候选影片' : '根据你的需求，我为你找到了以下影片'}
              </h2>
              {!tvMode ? (
                <p className='mt-1 text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
                  {result.answer}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        {activeSavedRecordId ? (
          <div className='flex shrink-0 flex-wrap gap-2'>
            <button
              disabled={actionsDisabled}
              data-tv-focus-key='ai-refresh'
              className={
                tvMode
                  ? 'inline-flex min-h-12 items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border))] px-5 py-3 text-lg disabled:opacity-60'
                  : 'inline-flex min-h-11 items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface-strong))] px-3 py-2 text-sm text-[rgb(var(--ui-text))] transition hover:border-[rgb(var(--ui-accent)/0.34)] hover:bg-white/10'
              }
              onClick={onRefresh}
              type='button'
            >
              <RefreshCw className='h-4 w-4' />
              刷新结果
            </button>
            <button
              disabled={actionsDisabled}
              data-tv-focus-key='ai-delete'
              className={
                tvMode
                  ? 'inline-flex min-h-12 items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border))] px-5 py-3 text-lg disabled:opacity-60'
                  : 'inline-flex min-h-11 items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface-strong))] px-3 py-2 text-sm text-[rgb(var(--ui-text-muted))] transition hover:border-[rgb(var(--ui-critical)/0.34)] hover:bg-[rgb(var(--ui-critical)/0.08)] hover:text-[rgb(var(--ui-critical))]'
              }
              onClick={() => void onDeleteRecord()}
              type='button'
            >
              <Trash2 className='h-4 w-4' />
              删除记录
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function AiFindCandidateNotes({
  result,
  tvMode,
}: Pick<AiFindResultGroupsProps, 'result' | 'tvMode'>) {
  return (
    <div className={tvMode ? 'space-y-3' : 'mt-4 space-y-3'}>
      {result.degraded && result.errorMessage ? (
        <p
          className={`${
            tvMode ? 'text-base' : 'text-xs'
          } text-[rgb(var(--ui-text-muted))]`}
        >
          已降级处理：{result.errorMessage}
        </p>
      ) : null}
      {!tvMode && result.candidateQueries.length > 0 ? (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-xs text-[rgb(var(--ui-text-muted))]'>
            候选影片：
          </span>
          {result.candidateQueries.map((candidate, index) => (
            <span
              className='inline-flex items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface-strong))] px-2.5 py-1 text-xs text-[rgb(var(--ui-text))]'
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
  );
}

function aiFindGroupSubtitle(group: AiFindResponse['groups'][number]) {
  if (group.notFound) return group.reason;
  return `${group.reason}，找到 ${group.groupedCount} 组聚合结果`;
}

function aiFindGroupTextClass(tvMode: boolean) {
  return tvMode ? 'text-lg' : 'text-sm';
}

function AiFindGroupHeading({
  group,
  tvMode,
}: {
  group: AiFindResponse['groups'][number];
  tvMode: boolean;
}) {
  if (tvMode) {
    return (
      <div className='space-y-2'>
        <h3 className='text-2xl font-semibold'>{group.query}</h3>
        <p className='line-clamp-2 text-lg leading-relaxed text-[rgb(var(--ui-text-muted))]'>
          {group.reason}
        </p>
      </div>
    );
  }

  return (
    <SectionHeader subtitle={aiFindGroupSubtitle(group)} title={group.query} />
  );
}

function AiFindGroupMatches({
  group,
  tvMode,
}: {
  group: AiFindResponse['groups'][number];
  tvMode: boolean;
}) {
  return (
    <div className={tvMode ? undefined : 'ui-ai-group-enter'}>
      <PosterGrid className='ui-search-results'>
        {group.groups.map((item) => (
          <div className='w-full' key={item.groupKey}>
            <VideoCard
              layout='result'
              tvMode={tvMode}
              from='search'
              items={item.items}
              query={
                group.query.trim() !== item.title ? group.query.trim() : ''
              }
            />
          </div>
        ))}
      </PosterGrid>
    </div>
  );
}

function AiFindGroupStatus({
  group,
  groupErrors,
  loadingGroups,
  tvMode,
}: {
  group: AiFindResponse['groups'][number];
  groupErrors: GroupLoadErrors;
  loadingGroups: string[];
  tvMode: boolean;
}) {
  if (group.groups.length > 0) {
    return <AiFindGroupMatches group={group} tvMode={tvMode} />;
  }

  const textClass = aiFindGroupTextClass(tvMode);
  if (loadingGroups.includes(group.query)) {
    return (
      <Surface
        className={`flex items-center justify-center gap-2 px-6 py-8 text-center ${textClass} text-[rgb(var(--ui-text-muted))]`}
        variant='plain'
      >
        <Loader2 className='h-4 w-4 animate-spin' />
        <span>正在查询这个候选片名的资源站结果</span>
      </Surface>
    );
  }

  if (groupErrors[group.query]) {
    return (
      <Surface
        className={`px-6 py-8 text-center ${textClass} text-[rgb(var(--ui-text-muted))]`}
        variant='plain'
      >
        {groupErrors[group.query]}
      </Surface>
    );
  }

  return (
    <Surface
      className={`px-6 py-8 text-center ${textClass} text-[rgb(var(--ui-text-muted))]`}
      variant='plain'
    >
      当前资源站没有找到这个候选片名
    </Surface>
  );
}

function AiFindResultGroup({
  group,
  groupErrors,
  loadingGroups,
  tvMode,
}: {
  group: AiFindResponse['groups'][number];
  groupErrors: GroupLoadErrors;
  loadingGroups: string[];
  tvMode: boolean;
}) {
  return (
    <section className='space-y-4' key={group.query}>
      <AiFindGroupHeading group={group} tvMode={tvMode} />
      <AiFindGroupStatus
        group={group}
        groupErrors={groupErrors}
        loadingGroups={loadingGroups}
        tvMode={tvMode}
      />
    </section>
  );
}

function AiFindSuggestions({
  hasPendingGroups,
  hasResults,
  onSuggestionClick,
  result,
  tvMode,
}: Pick<
  AiFindResultGroupsProps,
  'hasPendingGroups' | 'hasResults' | 'onSuggestionClick' | 'result' | 'tvMode'
>) {
  return (
    <>
      {!hasResults && !hasPendingGroups && result.suggestions.length > 0 ? (
        <Surface className='p-4 sm:p-5' variant='plain'>
          <div className='space-y-3'>
            <div
              className={`${
                tvMode ? 'text-lg' : 'text-sm'
              } text-[rgb(var(--ui-text-muted))]`}
            >
              可以尝试这些关键词：
            </div>
            <div className='flex flex-wrap gap-2'>
              {result.suggestions.map((suggestion) => (
                <button
                  className={
                    tvMode
                      ? 'min-h-12 rounded-ui-sm border border-[rgb(var(--ui-border))] px-5 py-3 text-lg'
                      : 'min-h-11 rounded-ui-sm border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface-strong))] px-3 py-2 text-sm text-[rgb(var(--ui-text))] transition hover:bg-white/10'
                  }
                  key={suggestion}
                  data-tv-focus-key={`ai-suggestion:${suggestion}`}
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
    </>
  );
}

export default function AiFindResultGroups({
  tvMode = false,
  actionsDisabled = false,
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
    <div className={tvMode ? 'space-y-8' : 'space-y-7'}>
      <Surface className='p-4 sm:p-5' variant='plain'>
        <AiFindResultToolbar
          actionsDisabled={actionsDisabled}
          activeSavedRecordId={activeSavedRecordId}
          onDeleteRecord={onDeleteRecord}
          onRefresh={onRefresh}
          result={result}
          tvMode={tvMode}
        />
        <AiFindCandidateNotes result={result} tvMode={tvMode} />
      </Surface>
      {tvMode && result.groups.length === 0 && !hasPendingGroups ? (
        <p className='text-lg leading-relaxed' role='status'>
          {result.answer || '没有找到候选影片，请补充片名线索后重试。'}
        </p>
      ) : null}
      {result.groups.map((group) => (
        <AiFindResultGroup
          group={group}
          groupErrors={groupErrors}
          key={group.query}
          loadingGroups={loadingGroups}
          tvMode={tvMode}
        />
      ))}
      <AiFindSuggestions
        hasPendingGroups={hasPendingGroups}
        hasResults={hasResults}
        onSuggestionClick={onSuggestionClick}
        result={result}
        tvMode={tvMode}
      />
    </div>
  );
}
