'use client';

import {
  CheckSquare,
  ChevronRight,
  Clock3,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';

import {
  type PlayRecord,
  clearAllPlayRecords,
  deletePlayRecordByKey,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  buildContinueWatchingRecords,
  resolveContinueWatchingRoute,
} from '@/lib/play-records';
import { buildTvModeHref, isTvMode } from '@/lib/tv-interaction';

import PageLayout from '@/components/PageLayout';
import ActionLink from '@/components/ui/ActionLink';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeader from '@/components/ui/SectionHeader';

type HistoryItem = PlayRecord & {
  key: string;
  groupedKeys: string[];
  source: string;
  id: string;
};

export const runtime = 'edge';

const historyDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(timestamp: number): string {
  if (!timestamp) return '未知时间';

  return historyDateFormatter.format(new Date(timestamp));
}

function formatProgress(record: PlayRecord): string {
  if (!record.total_time) return '未记录进度';

  const percent = Math.min(
    100,
    Math.max(0, Math.round((record.play_time / record.total_time) * 100))
  );
  return `已观看 ${percent}%`;
}

function buildPlayHref(item: HistoryItem, tvMode: boolean): string {
  const params = new URLSearchParams();
  params.set('source', item.source);
  params.set('id', item.id);
  params.set('title', item.title);
  if (item.year) params.set('year', item.year);
  if (item.search_title) params.set('stitle', item.search_title);
  params.set('stype', item.total_episodes > 1 ? 'tv' : '');
  params.set('from', 'playrecord');
  const href = `/play?${params.toString()}`;
  return tvMode ? buildTvModeHref(href, true) : href;
}

async function confirmDangerAction(options: {
  title: string;
  text: string;
  confirmButtonText: string;
  tvMode: boolean;
}): Promise<boolean> {
  const result = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText,
    cancelButtonText: '取消',
    confirmButtonColor: '#dc2626',
    focusCancel: true,
    customClass: { popup: options.tvMode ? 'tv-history-confirm' : '' },
  });

  return result.isConfirmed;
}

function HistoryHeading({ tvMode }: { tvMode: boolean }) {
  return (
    <PageHeader
      action={
        <ActionLink href={tvMode ? buildTvModeHref('/', true) : '/'}>
          返回首页
          <ChevronRight className='h-4 w-4 rotate-180' />
        </ActionLink>
      }
      subtitle='从上次停下的地方，继续观看。'
      title='播放历史'
    />
  );
}

function HistoryManageBar({
  allSelected,
  busy,
  items,
  managing,
  onClearAll,
  onDeleteSelected,
  onToggleManaging,
  onToggleSelectAll,
  selectedCount,
}: {
  allSelected: boolean;
  busy: boolean;
  items: HistoryItem[];
  managing: boolean;
  onClearAll: () => void;
  onDeleteSelected: () => void;
  onToggleManaging: () => void;
  onToggleSelectAll: () => void;
  selectedCount: number;
}) {
  return (
    <>
      <SectionHeader
        action={
          items.length > 0 ? (
            <button
              className='ui-action-link rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 min-h-11 px-4 text-sm font-medium'
              disabled={busy}
              onClick={onToggleManaging}
              type='button'
            >
              {managing ? '完成管理' : '管理记录'}
            </button>
          ) : undefined
        }
        subtitle={
          items.length > 0
            ? `共 ${items.length} 条${
                managing ? `，已选 ${selectedCount} 条` : ''
              }`
            : undefined
        }
        title='历史记录'
      />

      {managing && items.length > 0 ? (
        <div className='flex flex-wrap items-center justify-between gap-3 border-y border-[rgb(var(--ui-border))] py-3'>
          <button
            className='ui-action-link rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 inline-flex min-h-11 items-center gap-2 px-3 text-sm font-medium'
            disabled={busy}
            onClick={onToggleSelectAll}
            type='button'
          >
            {allSelected ? (
              <CheckSquare className='h-5 w-5' />
            ) : (
              <Square className='h-5 w-5' />
            )}
            {allSelected ? '取消全选' : '全选'}
          </button>
          <div className='flex flex-wrap gap-2'>
            <button
              className='ui-action-link rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 min-h-11 px-3 text-sm font-medium text-[rgb(var(--ui-critical))]'
              disabled={busy || selectedCount === 0}
              onClick={onDeleteSelected}
              type='button'
            >
              删除已选
            </button>
            <button
              className='ui-action-link rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 min-h-11 px-3 text-sm font-medium text-[rgb(var(--ui-critical))]'
              disabled={busy}
              onClick={onClearAll}
              type='button'
            >
              清空全部
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HistoryEntries({
  busy,
  dateGroups,
  items,
  loading,
  managing,
  onDeleteOne,
  onOpen,
  onToggleSelection,
  selectedKeys,
  tvMode,
}: {
  busy: boolean;
  dateGroups: { title: string; items: HistoryItem[] }[];
  items: HistoryItem[];
  loading: boolean;
  managing: boolean;
  onDeleteOne: (item: HistoryItem) => void;
  onOpen: (item: HistoryItem) => void;
  onToggleSelection: (key: string) => void;
  selectedKeys: Set<string>;
  tvMode: boolean;
}) {
  return (
    <>
      {loading ? (
        <div aria-label='正在加载播放历史' className='space-y-4'>
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className='flex gap-4 rounded-ui-md bg-[rgb(var(--ui-surface))] p-4'
            >
              <div className='aspect-video w-28 shrink-0 animate-pulse rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] sm:w-48' />
              <div className='flex-1 space-y-3 py-2'>
                <div className='h-5 w-2/3 animate-pulse rounded bg-[rgb(var(--ui-surface-strong))]' />
                <div className='h-4 w-1/2 animate-pulse rounded bg-[rgb(var(--ui-surface-strong))]' />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-ui-md bg-[rgb(var(--ui-surface))] px-4 py-12 text-center'>
          <Clock3
            aria-hidden
            className='mx-auto mb-4 h-8 w-8 text-[rgb(var(--ui-text-muted))]'
          />
          <h2 className='text-lg font-semibold text-[rgb(var(--ui-text))]'>
            暂无播放历史
          </h2>
          <p className='mb-6 mt-2 text-sm text-[rgb(var(--ui-text-muted))]'>
            开始观看后，播放进度会保存在这里。
          </p>
          <ActionLink
            href={tvMode ? buildTvModeHref('/search', true) : '/search'}
          >
            搜索影片
            <ChevronRight className='h-4 w-4' />
          </ActionLink>
        </div>
      ) : (
        dateGroups.map((group) => (
          <section
            key={group.title}
            aria-label={group.title}
            className='space-y-3'
          >
            <h2 className='text-lg font-semibold text-[rgb(var(--ui-text))]'>
              {group.title}
            </h2>
            {group.items.map((item) => {
              const selected = selectedKeys.has(item.key);
              const progress =
                item.total_time > 0
                  ? Math.min(
                      100,
                      Math.max(0, (item.play_time / item.total_time) * 100)
                    )
                  : 0;
              return (
                <div
                  key={item.key}
                  className='ui-history-row flex flex-wrap items-center gap-3 rounded-ui-md bg-[rgb(var(--ui-surface))] p-3 sm:gap-4 sm:p-4'
                >
                  {managing ? (
                    <button
                      aria-label={selected ? '取消选择' : '选择播放记录'}
                      aria-pressed={selected}
                      className='ui-icon-button shrink-0'
                      disabled={busy}
                      onClick={() => onToggleSelection(item.key)}
                      type='button'
                    >
                      {selected ? (
                        <CheckSquare className='h-5 w-5 text-[rgb(var(--ui-accent))]' />
                      ) : (
                        <Square className='h-5 w-5' />
                      )}
                    </button>
                  ) : null}
                  <button
                    aria-label={`继续播放 ${item.title}`}
                    tabIndex={tvMode ? -1 : undefined}
                    className='ui-history-image relative aspect-video w-28 shrink-0 overflow-hidden rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] text-left sm:w-48'
                    onClick={() => onOpen(item)}
                    type='button'
                  >
                    {item.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=''
                        className='h-full w-full object-cover'
                        loading='lazy'
                        src={item.cover}
                      />
                    ) : (
                      <span className='flex h-full w-full items-center justify-center px-2 text-center text-sm text-[rgb(var(--ui-text-muted))]'>
                        {item.title}
                      </span>
                    )}
                  </button>
                  <div className='min-w-0 flex-1 basis-32'>
                    <button
                      tabIndex={tvMode ? -1 : undefined}
                      className='line-clamp-2 max-w-full text-left text-base font-semibold text-[rgb(var(--ui-text))] transition-colors hover:text-[rgb(var(--ui-accent))]'
                      onClick={() => onOpen(item)}
                      type='button'
                    >
                      {item.title}
                    </button>
                    <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--ui-text-muted))]'>
                      <span>
                        {item.total_episodes > 1
                          ? `第 ${item.index}/${item.total_episodes} 集`
                          : '电影'}
                      </span>
                      {item.year ? <span>{item.year}</span> : null}
                      <span>{item.source_name}</span>
                    </div>
                    <div
                      className='mt-3 h-1 max-w-sm overflow-hidden rounded-full bg-[rgb(var(--ui-surface-strong))]'
                      aria-hidden='true'
                    >
                      <div
                        className='h-full bg-[rgb(var(--ui-accent))]'
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[rgb(var(--ui-text-muted))]'>
                      <span>{formatProgress(item)}</span>
                      <span>{formatDate(item.save_time)}</span>
                    </div>
                  </div>
                  <div className='ui-history-actions flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-col sm:items-stretch'>
                    <button
                      data-tv-primary={tvMode || undefined}
                      data-tv-focus-key={`history:${item.key}`}
                      className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-2 text-sm font-semibold text-[rgb(var(--ui-on-accent))] transition-colors hover:brightness-110'
                      onClick={() => onOpen(item)}
                      type='button'
                    >
                      <Play aria-hidden className='h-4 w-4' />
                      继续播放
                    </button>
                    {managing ? (
                      <button
                        className='ui-action-link rounded-ui-sm bg-[rgb(var(--ui-surface-strong))] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[rgb(var(--ui-critical))]'
                        disabled={busy}
                        onClick={() => onDeleteOne(item)}
                        type='button'
                      >
                        <Trash2 aria-hidden className='h-4 w-4' />
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}
    </>
  );
}

function HistoryClient() {
  const router = useRouter();
  const tvMode = isTvMode(useSearchParams());
  const [records, setRecords] = useState<Record<string, PlayRecord>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);

  const items = useMemo<HistoryItem[]>(() => {
    // 复用继续观看的归一逻辑：同一视频的不同源/wp+legacy 记录合并成一条
    return buildContinueWatchingRecords(records)
      .map((record) => {
        const route = resolveContinueWatchingRoute(record);
        if (!route) return null;
        return {
          ...record,
          source: route.source,
          id: route.id,
        };
      })
      .filter((item): item is HistoryItem => Boolean(item));
  }, [records]);

  const dateGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return [
      {
        title: '今天',
        items: items.filter((item) => item.save_time >= today.getTime()),
      },
      {
        title: '昨天',
        items: items.filter(
          (item) =>
            item.save_time >= yesterday.getTime() &&
            item.save_time < today.getTime()
        ),
      },
      {
        title: '更早',
        items: items.filter(
          (item) => !item.save_time || item.save_time < yesterday.getTime()
        ),
      },
    ].filter((group) => group.items.length > 0);
  }, [items]);

  const selectedCount = selectedKeys.size;
  const allSelected = items.length > 0 && selectedCount === items.length;

  useEffect(() => {
    let mounted = true;

    const loadRecords = async () => {
      try {
        setLoading(true);
        const allRecords = await getAllPlayRecords();
        if (mounted) {
          setRecords(allRecords);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadRecords();

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        setRecords(newRecords);
        setSelectedKeys((prev) => {
          const next = new Set<string>();
          Object.keys(newRecords).forEach((key) => {
            if (prev.has(key)) next.add(key);
          });
          return next;
        });
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      if (prev.size === items.length) {
        return new Set();
      }
      return new Set(items.map((item) => item.key));
    });
  };

  const removeItems = async (targets: HistoryItem[]) => {
    if (targets.length === 0) return;

    setBusy(true);
    try {
      for (const target of targets) {
        // 删除整组（wp 主键 + 各源 legacy 键），避免残留记录再次拆分显示
        for (const groupedKey of target.groupedKeys) {
          await deletePlayRecordByKey(groupedKey);
        }
      }
      setSelectedKeys(new Set());
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteOne = async (item: HistoryItem) => {
    const confirmed = await confirmDangerAction({
      tvMode,
      title: '删除这条播放记录？',
      text: item.title,
      confirmButtonText: '删除',
    });
    if (!confirmed) return;
    await removeItems([item]);
  };

  const handleDeleteSelected = async () => {
    const targets = items.filter((item) => selectedKeys.has(item.key));
    const confirmed = await confirmDangerAction({
      tvMode,
      title: `删除已选 ${targets.length} 条记录？`,
      text: '删除后这些播放进度不会再出现在继续观看和历史记录中。',
      confirmButtonText: '删除已选',
    });
    if (!confirmed) return;
    await removeItems(targets);
  };

  const handleClearAll = async () => {
    const confirmed = await confirmDangerAction({
      tvMode,
      title: '清空全部播放历史？',
      text: '这会删除当前账号的所有播放记录，操作不可撤销。',
      confirmButtonText: '清空全部',
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await clearAllPlayRecords();
      setRecords({});
      setSelectedKeys(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout activePath='/history' tvMode={tvMode}>
      <div className='ui-history-page space-y-8'>
        <HistoryHeading tvMode={tvMode} />
        <section className='space-y-6' aria-label='历史记录'>
          <HistoryManageBar
            allSelected={allSelected}
            busy={busy}
            items={items}
            managing={managing}
            onClearAll={() => void handleClearAll()}
            onDeleteSelected={() => void handleDeleteSelected()}
            onToggleManaging={() => {
              setManaging((value) => !value);
              setSelectedKeys(new Set());
            }}
            onToggleSelectAll={toggleSelectAll}
            selectedCount={selectedCount}
          />
          <HistoryEntries
            busy={busy}
            dateGroups={dateGroups}
            items={items}
            loading={loading}
            managing={managing}
            onDeleteOne={(item) => void handleDeleteOne(item)}
            onOpen={(item) => router.push(buildPlayHref(item, tvMode))}
            onToggleSelection={toggleSelection}
            selectedKeys={selectedKeys}
            tvMode={tvMode}
          />
        </section>
      </div>
    </PageLayout>
  );
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <PageLayout activePath='/history'>正在加载播放历史…</PageLayout>
      }
    >
      <HistoryClient />
    </Suspense>
  );
}
