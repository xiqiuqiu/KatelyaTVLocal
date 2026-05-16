'use client';

import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import type { AiFindResponse } from '@/lib/ai-find/types';

import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import Surface from '@/components/ui/Surface';
import VideoCard from '@/components/VideoCard';

const loadingSteps = [
  '正在理解你的找片需求',
  '正在生成候选片名',
  '正在查询可用资源站',
  '正在整理聚合结果',
];

function getLoadingText(startedAt: number | null): string {
  if (!startedAt) return loadingSteps[0];

  const elapsed = Date.now() - startedAt;
  const index = Math.min(
    loadingSteps.length - 1,
    Math.floor(elapsed / 1800)
  );
  return loadingSteps[index];
}

export default function AiFindPanel() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AiFindResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const lastSearchQueryRef = useRef(searchParams.get('q') || '');

  const loadingText = getLoadingText(startedAt);

  useEffect(() => {
    const currentSearchQuery = searchParams.get('q') || '';

    if (currentSearchQuery !== lastSearchQueryRef.current) {
      lastSearchQueryRef.current = currentSearchQuery;
      setResult(null);
      setError(null);
    }
  }, [searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    setResult(null);

    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 600);

    try {
      const response = await fetch('/api/ai/find', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: trimmedQuery,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'AI 找片失败');
      }

      setResult(payload as AiFindResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 找片失败');
    } finally {
      window.clearInterval(intervalId);
      setLoading(false);
      setStartedAt(null);
    }
  };

  const hasResults =
    result?.groups.some((group) => group.groups.length > 0) ?? false;

  return (
    <section className='space-y-5'>
      <Surface className='p-4 sm:p-5' variant='plain'>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='flex items-center gap-2 text-sm font-medium text-[rgb(var(--ui-text))]'>
            <Sparkles className='h-4 w-4 text-[rgb(var(--ui-success))]' />
            <span>AI 找片</span>
          </div>

          <div className='flex flex-col gap-3 sm:flex-row'>
            <input
              className='min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-[rgb(var(--ui-text))] outline-none transition focus:border-[rgb(var(--ui-success)/0.5)] focus:bg-white/10'
              disabled={loading}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='例如：想看节奏快一点的国产悬疑剧，不要太老'
              value={query}
            />
            <button
              className='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--ui-success))] px-5 text-sm font-semibold text-[rgb(var(--ui-on-accent))] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={loading || !query.trim()}
              type='submit'
            >
              {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
              {loading ? '查找中' : '开始找片'}
            </button>
          </div>

          {loading ? (
            <div className='text-sm text-[rgb(var(--ui-text-muted))]'>
              {loadingText}
            </div>
          ) : null}

          {error ? (
            <div className='flex items-center gap-2 text-sm text-[rgb(var(--ui-critical))]'>
              <AlertCircle className='h-4 w-4' />
              <span>{error}</span>
            </div>
          ) : null}
        </form>
      </Surface>

      {result ? (
        <div className='space-y-7'>
          <Surface className='p-4 sm:p-5' variant='plain'>
            <div className='space-y-3'>
              <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
                {result.answer}
              </p>
              {result.degraded && result.errorMessage ? (
                <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
                  已降级处理：{result.errorMessage}
                </p>
              ) : null}
              {result.candidateQueries.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {result.candidateQueries.map((candidate) => (
                    <span
                      className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[rgb(var(--ui-text))]'
                      key={`${candidate.query}-${candidate.reason}`}
                    >
                      {candidate.query}
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

          {!hasResults && result.suggestions.length > 0 ? (
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
                      onClick={() => setQuery(suggestion)}
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
      ) : null}
    </section>
  );
}
