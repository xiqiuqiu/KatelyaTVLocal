'use client';

import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
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

import AiFindResultGroups from '@/components/AiFindResultGroups';
import AiFindSavedRecordsList from '@/components/AiFindSavedRecordsList';
import Surface from '@/components/ui/Surface';

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

      if (activeRunRef.current !== runId) {
        return;
      }

      const payload = (await response.json()) as
        | AiFindResponse
        | { error?: string; [key: string]: unknown };

      if (activeRunRef.current !== runId) {
        return;
      }
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

      if (activeRunRef.current !== runId) {
        return;
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
      if (activeRunRef.current !== runId) {
        return;
      }

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
      if (activeRunRef.current === runId) {
        window.clearInterval(intervalId);
        setLoading(false);
        setStartedAt(null);
      }
    }
  };

  const handleSelectSavedRecord = async (recordId: string) => {
    const saved = await getAiFindSavedRecord(recordId);
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
  };

  const handleDeleteSavedRecord = async () => {
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

      <AiFindSavedRecordsList
        activeSavedRecordId={activeSavedRecordId}
        onSelectRecord={handleSelectSavedRecord}
        savedRecords={savedRecords}
      />

      {result ? (
        <AiFindResultGroups
          activeSavedRecordId={activeSavedRecordId}
          groupErrors={groupErrors}
          hasPendingGroups={hasPendingGroups}
          hasResults={hasResults}
          loadingGroups={loadingGroups}
          onDeleteRecord={handleDeleteSavedRecord}
          onRefresh={() => {
            formRef.current?.requestSubmit();
          }}
          onSuggestionClick={setQuery}
          result={result}
        />
      ) : null}
    </section>
  );
}
