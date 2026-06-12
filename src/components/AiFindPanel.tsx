'use client';

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Info,
  Loader2,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import {
  AI_FIND_DEBUG_HEADER,
  AI_FIND_DEBUG_RESPONSE_HEADER,
  AI_FIND_REQUEST_ID_HEADER,
  createAiFindRequestId,
  sanitizeAiFindDebugText,
} from '@/lib/ai-find/debug';
import {
  createAiFindSavedRecordId,
  deleteAiFindSavedRecord,
  getAiFindSavedRecord,
  listAiFindSavedRecords,
  saveAiFindSavedRecordSnapshot,
} from '@/lib/ai-find/history-client';
import type {
  AiFindCandidateQuery,
  AiFindResponse,
  AiFindResultGroup,
} from '@/lib/ai-find/types';
import type {
  AiFindSavedRecordStatus,
  AiFindSavedRecordSummary,
} from '@/lib/types';

import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import Surface from '@/components/ui/Surface';
import VideoCard from '@/components/VideoCard';

const loadingSteps = ['正在理解你的找片需求', '正在生成候选片名'];

type GroupLoadErrors = Record<string, string>;
const GROUP_LOAD_CONCURRENCY = 2;

function getLoadingText(startedAt: number | null): string {
  if (!startedAt) return loadingSteps[0];

  const elapsed = Date.now() - startedAt;
  const index = Math.min(loadingSteps.length - 1, Math.floor(elapsed / 1800));
  return loadingSteps[index];
}

function isClientDebugEnabled(
  searchParams: ReturnType<typeof useSearchParams>
) {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  if (searchParams.get('aiDebug') === '1') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem('ai-find-debug') === '1';
  } catch {
    return false;
  }
}

function logAiFindClientDebug(
  enabled: boolean,
  requestId: string,
  event: string,
  details: Record<string, unknown>
) {
  if (!enabled) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[ai-find][client][${requestId}] ${event}`, details);
}

function summarizeResult(payload: AiFindResponse) {
  return {
    candidateCount: payload.candidateQueries.length,
    candidateQueries: payload.candidateQueries.map(
      (candidate) => candidate.query
    ),
    groupCount: payload.groups.length,
    foundCount: payload.groups.reduce(
      (count, group) => count + group.groupedCount,
      0
    ),
    suggestionCount: payload.suggestions.length,
    degraded: Boolean(payload.degraded),
    errorMessage: payload.errorMessage,
  };
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

function getConfidenceLabel(confidence: AiFindCandidateQuery['confidence']) {
  if (confidence === 'high') return '高匹配';
  if (confidence === 'medium') return '可参考';
  return '待确认';
}

function getSavedRecordInitials(query: string): string[] {
  const compact = query.replace(/\s/g, '');
  return [
    compact.slice(0, 2) || 'AI',
    compact.slice(2, 4) || '找片',
    compact.slice(4, 6) || '结果',
  ];
}

function createPendingGroup(
  candidate: AiFindCandidateQuery
): AiFindResultGroup {
  return {
    query: candidate.query,
    reason: candidate.reason,
    confidence: candidate.confidence,
    rawCount: 0,
    groupedCount: 0,
    groups: [],
  };
}

interface AiFindPanelProps {
  initialQuery?: string;
}

export default function AiFindPanel({ initialQuery = '' }: AiFindPanelProps) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AiFindResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState<string[]>([]);
  const [groupErrors, setGroupErrors] = useState<GroupLoadErrors>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedRecords, setSavedRecords] = useState<AiFindSavedRecordSummary[]>(
    []
  );
  const [activeSavedRecordId, setActiveSavedRecordId] = useState<string | null>(
    null
  );
  const [, setTick] = useState(0);
  const lastSearchQueryRef = useRef(searchParams.get('q') || '');
  const activeRunRef = useRef<string | null>(null);
  const activeSavedRecordIdRef = useRef<string | null>(null);
  const activeSavedRecordCreatedAtRef = useRef<number | null>(null);
  const activeSavedRecordQueryRef = useRef<string | null>(null);
  const deletedSavedRecordIdsRef = useRef<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastInitialQueryRef = useRef('');

  const loadingText = getLoadingText(startedAt);

  useEffect(() => {
    const currentSearchQuery = searchParams.get('q') || '';

    if (currentSearchQuery !== lastSearchQueryRef.current) {
      lastSearchQueryRef.current = currentSearchQuery;
      setResult(null);
      setError(null);
      setLoadingGroups([]);
      setGroupErrors({});
    }
  }, [searchParams]);

  useEffect(() => {
    const nextInitialQuery = initialQuery.trim();
    if (!nextInitialQuery || nextInitialQuery === lastInitialQueryRef.current) {
      return;
    }

    lastInitialQueryRef.current = nextInitialQuery;
    setQuery((current) => (current.trim() ? current : nextInitialQuery));
  }, [initialQuery]);

  useEffect(() => {
    let mounted = true;

    void listAiFindSavedRecords().then((records) => {
      if (mounted) {
        setSavedRecords(records);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const refreshSavedRecords = async () => {
    setSavedRecords(await listAiFindSavedRecords());
  };

  const persistSavedSnapshot = ({
    id,
    originalQuery,
    response,
    status,
    createdAt,
  }: {
    id: string;
    originalQuery: string;
    response: AiFindResponse;
    status: AiFindSavedRecordStatus;
    createdAt: number;
  }) => {
    if (deletedSavedRecordIdsRef.current.has(id)) {
      return;
    }

    saveAiFindSavedRecordSnapshot({
      id,
      query: originalQuery,
      response,
      status,
      createdAt,
    })
      .then(refreshSavedRecords)
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Failed to persist AI find saved snapshot:', err);
      });
  };

  const loadCandidateGroup = async ({
    candidate,
    runId,
    debugEnabled,
    parentRequestId,
    originalQuery,
  }: {
    candidate: AiFindCandidateQuery;
    runId: string;
    debugEnabled: boolean;
    parentRequestId: string;
    originalQuery: string;
  }) => {
    const groupRequestId = `${parentRequestId}-g-${Math.random()
      .toString(36)
      .slice(2, 6)}`.slice(0, 64);
    const groupStartedAt = Date.now();

    try {
      logAiFindClientDebug(debugEnabled, groupRequestId, 'group dispatched', {
        query: sanitizeAiFindDebugText(candidate.query),
      });

      const response = await fetch('/api/ai/find/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [AI_FIND_REQUEST_ID_HEADER]: groupRequestId,
          ...(debugEnabled ? { [AI_FIND_DEBUG_HEADER]: '1' } : {}),
        },
        body: JSON.stringify({
          candidate,
        }),
      });
      const payload = (await response.json()) as {
        group?: AiFindResultGroup;
        failed?: boolean;
        error?: string;
      };

      if (activeRunRef.current !== runId) {
        return;
      }

      if (!response.ok || !payload.group) {
        throw new Error(payload.error || '候选片名搜索失败');
      }
      const receivedGroup = payload.group;

      logAiFindClientDebug(debugEnabled, groupRequestId, 'group received', {
        status: response.status,
        durationMs: Date.now() - groupStartedAt,
        query: receivedGroup.query,
        groupedCount: receivedGroup.groupedCount,
        failed: Boolean(payload.failed),
      });

      setResult((current) => {
        if (!current) return current;

        const next = {
          ...current,
          groups: current.groups.map((group) =>
            group.query === candidate.query ? receivedGroup : group
          ),
          degraded: current.degraded || Boolean(payload.failed),
          errorMessage:
            current.errorMessage ||
            (payload.failed ? '部分候选片名查询失败。' : undefined),
        };

        const savedRecordId = activeSavedRecordIdRef.current;
        const createdAt = activeSavedRecordCreatedAtRef.current;
        if (savedRecordId && createdAt) {
          const hasPendingGroups = next.groups.some(
            (group) => group.groups.length === 0 && !group.notFound
          );
          persistSavedSnapshot({
            id: savedRecordId,
            originalQuery,
            response: next,
            status: hasPendingGroups ? 'partial' : 'complete',
            createdAt,
          });
        }

        return next;
      });
    } catch (err) {
      if (activeRunRef.current !== runId) {
        return;
      }

      const message = err instanceof Error ? err.message : '候选片名搜索失败';
      setGroupErrors((current) => ({
        ...current,
        [candidate.query]: message,
      }));
      setResult((current) => {
        if (!current) return current;

        const next = {
          ...current,
          groups: current.groups.map((group) =>
            group.query === candidate.query
              ? {
                  ...group,
                  notFound: true,
                }
              : group
          ),
          degraded: true,
          errorMessage: current.errorMessage || '部分候选片名查询失败。',
        };

        const savedRecordId = activeSavedRecordIdRef.current;
        const createdAt = activeSavedRecordCreatedAtRef.current;
        if (savedRecordId && createdAt) {
          const hasPendingGroups = next.groups.some(
            (group) => group.groups.length === 0 && !group.notFound
          );
          persistSavedSnapshot({
            id: savedRecordId,
            originalQuery,
            response: next,
            status: hasPendingGroups ? 'partial' : 'complete',
            createdAt,
          });
        }

        return next;
      });
    } finally {
      if (activeRunRef.current === runId) {
        setLoadingGroups((current) =>
          current.filter((query) => query !== candidate.query)
        );
      }
    }
  };

  const loadCandidateGroups = async ({
    candidates,
    runId,
    debugEnabled,
    parentRequestId,
    originalQuery,
  }: {
    candidates: AiFindCandidateQuery[];
    runId: string;
    debugEnabled: boolean;
    parentRequestId: string;
    originalQuery: string;
  }) => {
    let currentIndex = 0;

    const runWorker = async () => {
      while (currentIndex < candidates.length) {
        const nextIndex = currentIndex;
        currentIndex += 1;
        await loadCandidateGroup({
          candidate: candidates[nextIndex],
          runId,
          debugEnabled,
          parentRequestId,
          originalQuery,
        });
      }
    };

    const workerCount = Math.min(GROUP_LOAD_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const debugEnabled = isClientDebugEnabled(searchParams);
    const clientRequestId = createAiFindRequestId();
    const runId = clientRequestId;
    const requestStartedAt = Date.now();
    let activeRequestId = clientRequestId;
    let activeDebugEnabled = debugEnabled;
    activeRunRef.current = runId;
    const shouldUpdateActiveRecord =
      activeSavedRecordIdRef.current !== null &&
      activeSavedRecordQueryRef.current === trimmedQuery;

    logAiFindClientDebug(debugEnabled, clientRequestId, 'submit started', {
      query: sanitizeAiFindDebugText(trimmedQuery),
      queryLength: trimmedQuery.length,
      pageQuery: searchParams.get('q') || '',
      path:
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/search',
    });

    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    setResult(null);
    setLoadingGroups([]);
    setGroupErrors({});

    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 600);

    try {
      logAiFindClientDebug(
        debugEnabled,
        clientRequestId,
        'request dispatched',
        {
          endpoint: '/api/ai/find',
          payload: {
            query: sanitizeAiFindDebugText(trimmedQuery),
          },
        }
      );

      const response = await fetch('/api/ai/find', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [AI_FIND_REQUEST_ID_HEADER]: clientRequestId,
          ...(debugEnabled ? { [AI_FIND_DEBUG_HEADER]: '1' } : {}),
        },
        body: JSON.stringify({
          query: trimmedQuery,
          resolveGroups: false,
        }),
      });

      const payload = (await response.json()) as
        | AiFindResponse
        | { error?: string; [key: string]: unknown };
      const serverRequestId =
        response.headers.get(AI_FIND_REQUEST_ID_HEADER) || clientRequestId;
      const serverDebugEnabled =
        response.headers.get(AI_FIND_DEBUG_RESPONSE_HEADER) === '1';

      activeRequestId = serverRequestId;
      activeDebugEnabled = debugEnabled || serverDebugEnabled;

      logAiFindClientDebug(
        activeDebugEnabled,
        activeRequestId,
        'response received',
        {
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - requestStartedAt,
          serverDebugEnabled,
          summary: response.ok
            ? summarizeResult(payload as AiFindResponse)
            : undefined,
          error: !response.ok
            ? (payload as { error?: string }).error
            : undefined,
        }
      );

      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'AI 找片失败');
      }

      const candidatePayload = payload as AiFindResponse;
      const pendingGroups =
        candidatePayload.candidateQueries.map(createPendingGroup);
      const nextResult = {
        ...candidatePayload,
        groups: pendingGroups,
      };
      setResult(nextResult);
      const savedRecordId = shouldUpdateActiveRecord
        ? activeSavedRecordIdRef.current || createAiFindSavedRecordId()
        : createAiFindSavedRecordId();
      const savedRecordCreatedAt =
        shouldUpdateActiveRecord && activeSavedRecordCreatedAtRef.current
          ? activeSavedRecordCreatedAtRef.current
          : Date.now();
      activeSavedRecordIdRef.current = savedRecordId;
      activeSavedRecordCreatedAtRef.current = savedRecordCreatedAt;
      activeSavedRecordQueryRef.current = trimmedQuery;
      deletedSavedRecordIdsRef.current.delete(savedRecordId);
      setActiveSavedRecordId(savedRecordId);
      persistSavedSnapshot({
        id: savedRecordId,
        originalQuery: trimmedQuery,
        response: nextResult,
        status: 'partial',
        createdAt: savedRecordCreatedAt,
      });
      setLoadingGroups(
        candidatePayload.candidateQueries.map((candidate) => candidate.query)
      );
      setLoading(false);
      setStartedAt(null);
      window.clearInterval(intervalId);

      logAiFindClientDebug(
        activeDebugEnabled,
        activeRequestId,
        'state updated',
        {
          hasResults: false,
          candidateQueries: candidatePayload.candidateQueries.map(
            (candidate) => candidate.query
          ),
        }
      );

      void loadCandidateGroups({
        candidates: candidatePayload.candidateQueries,
        runId,
        debugEnabled: activeDebugEnabled,
        parentRequestId: activeRequestId,
        originalQuery: trimmedQuery,
      });
    } catch (err) {
      logAiFindClientDebug(
        activeDebugEnabled,
        activeRequestId,
        'request failed',
        {
          durationMs: Date.now() - requestStartedAt,
          errorMessage: err instanceof Error ? err.message : 'AI 找片失败',
        }
      );

      setError(err instanceof Error ? err.message : 'AI 找片失败');
    } finally {
      window.clearInterval(intervalId);
      setLoading(false);
      setStartedAt(null);
    }
  };

  const hasResults =
    result?.groups.some((group) => group.groups.length > 0) ?? false;
  const hasPendingGroups = loadingGroups.length > 0;

  return (
    <section className='space-y-7'>
      <Surface
        className='border-[rgb(var(--ui-success)/0.22)] bg-[linear-gradient(180deg,rgb(var(--ui-surface)/0.72),rgb(var(--ui-bg-elevated)/0.46))] p-5 shadow-[0_24px_70px_rgb(0_0_0/0.28)] sm:p-6'
        variant='plain'
      >
        <form className='space-y-5' onSubmit={handleSubmit} ref={formRef}>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <div className='flex h-9 w-9 items-center justify-center rounded-xl border border-[rgb(var(--ui-success)/0.28)] bg-[rgb(var(--ui-success)/0.14)] text-[rgb(var(--ui-success))] shadow-[0_0_26px_rgb(var(--ui-success)/0.12)]'>
                <Sparkles className='h-5 w-5' />
              </div>
              <div>
                <div className='flex items-center gap-2 text-lg font-semibold text-[rgb(var(--ui-text))]'>
                  <span>AI 找片</span>
                  <Info className='h-4 w-4 text-[rgb(var(--ui-text-muted))]' />
                </div>
                <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
                  描述片名线索、年代、演员或观影偏好
                </p>
              </div>
            </div>
          </div>

          <div className='flex flex-col gap-3 rounded-2xl border border-white/10 bg-[rgb(var(--ui-bg-elevated)/0.72)] p-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] sm:flex-row'>
            <input
              className='min-h-12 flex-1 rounded-xl border border-transparent bg-white/[0.035] px-4 text-sm text-[rgb(var(--ui-text))] outline-none transition placeholder:text-[rgb(var(--ui-text-muted)/0.68)] focus:border-[rgb(var(--ui-success)/0.42)] focus:bg-white/[0.07]'
              disabled={loading}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='例如：90年代经典港片动作片，想看节奏快一点'
              value={query}
            />
            <button
              className='inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--ui-success))] px-5 text-sm font-semibold text-[rgb(var(--ui-on-accent))] shadow-[0_14px_30px_rgb(var(--ui-success)/0.24)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={loading || !query.trim()}
              type='submit'
            >
              {loading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Sparkles className='h-4 w-4' />
              )}
              {loading ? '查找中' : '开始找片'}
            </button>
          </div>

          <div className='flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--ui-text-muted))]'>
            <CheckCircle2 className='h-4 w-4 text-[rgb(var(--ui-success))]' />
            <span>将保存本次结果，之后可直接打开</span>
            {loading ? (
              <span className='ml-1 text-[rgb(var(--ui-success))]'>
                {loadingText}
              </span>
            ) : null}
          </div>

          {error ? (
            <div className='flex items-center gap-2 rounded-xl border border-[rgb(var(--ui-critical)/0.22)] bg-[rgb(var(--ui-critical)/0.08)] px-3 py-2 text-sm text-[rgb(var(--ui-critical))]'>
              <AlertCircle className='h-4 w-4' />
              <span>{error}</span>
            </div>
          ) : null}
        </form>
      </Surface>

      {savedRecords.length > 0 ? (
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
                  className={`group relative min-h-[9.25rem] overflow-hidden rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[rgb(var(--ui-success)/0.42)] hover:bg-white/[0.075] ${
                    activeSavedRecordId === record.id
                      ? 'border-[rgb(var(--ui-success)/0.46)] bg-[rgb(var(--ui-success)/0.09)]'
                      : 'border-white/10 bg-white/[0.045]'
                  }`}
                  key={record.id}
                  onClick={async () => {
                    const saved = await getAiFindSavedRecord(record.id);
                    if (!saved) return;

                    setQuery(saved.query);
                    setResult(saved.response);
                    setActiveSavedRecordId(saved.id);
                    activeSavedRecordIdRef.current = saved.id;
                    activeSavedRecordCreatedAtRef.current = saved.createdAt;
                    activeSavedRecordQueryRef.current = saved.query;
                    setLoading(false);
                    setLoadingGroups([]);
                    setGroupErrors({});
                    setError(null);
                    await refreshSavedRecords();
                  }}
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
      ) : null}

      {result ? (
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
                    onClick={() => {
                      formRef.current?.requestSubmit();
                    }}
                    type='button'
                  >
                    <RefreshCw className='h-4 w-4' />
                    刷新结果
                  </button>
                  <button
                    className='inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-[rgb(var(--ui-text-muted))] transition hover:border-[rgb(var(--ui-critical)/0.34)] hover:bg-[rgb(var(--ui-critical)/0.08)] hover:text-[rgb(var(--ui-critical))]'
                    onClick={async () => {
                      const recordId = activeSavedRecordIdRef.current;
                      if (!recordId) return;

                      deletedSavedRecordIdsRef.current.add(recordId);
                      activeSavedRecordIdRef.current = null;
                      activeSavedRecordCreatedAtRef.current = null;
                      activeSavedRecordQueryRef.current = null;
                      setActiveSavedRecordId(null);
                      setResult(null);
                      setLoadingGroups([]);
                      setGroupErrors({});
                      setError(null);
                      setSavedRecords((current) =>
                        current.filter((record) => record.id !== recordId)
                      );
                      await deleteAiFindSavedRecord(recordId);
                      await refreshSavedRecords();
                    }}
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
