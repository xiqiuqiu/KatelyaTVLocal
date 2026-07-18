'use client';

import {
  CheckSquare,
  ChevronRight,
  Clock3,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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

import PageLayout from '@/components/PageLayout';
import ActionLink from '@/components/ui/ActionLink';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeader from '@/components/ui/SectionHeader';

type HistoryItem = PlayRecord & {
  key: string;
  groupedKeys: string[];
  source: string;
  id: string;
};

export const runtime = 'edge';

function formatDate(timestamp: number): string {
  if (!timestamp) return '未知时间';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatProgress(record: PlayRecord): string {
  if (!record.total_time) return '未记录进度';

  const percent = Math.min(
    100,
    Math.max(0, Math.round((record.play_time / record.total_time) * 100))
  );
  return `已观看 ${percent}%`;
}

function buildPlayHref(item: HistoryItem): string {
  const params = new URLSearchParams();
  params.set('source', item.source);
  params.set('id', item.id);
  params.set('title', item.title);
  if (item.year) params.set('year', item.year);
  if (item.search_title) params.set('stitle', item.search_title);
  params.set('stype', item.total_episodes > 1 ? 'tv' : '');
  params.set('from', 'playrecord');
  return `/play?${params.toString()}`;
}

async function confirmDangerAction(options: {
  title: string;
  text: string;
  confirmButtonText: string;
}): Promise<boolean> {
  const result = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText,
    cancelButtonText: '取消',
    confirmButtonColor: '#dc2626',
  });

  return result.isConfirmed;
}

export default function HistoryPage() {
  const router = useRouter();
  const [records, setRecords] = useState<Record<string, PlayRecord>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
      title: `删除已选 ${targets.length} 条记录？`,
      text: '删除后这些播放进度不会再出现在继续观看和历史记录中。',
      confirmButtonText: '删除已选',
    });
    if (!confirmed) return;
    await removeItems(targets);
  };

  const handleClearAll = async () => {
    const confirmed = await confirmDangerAction({
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
    <PageLayout activePath='/history'>
      <div className='space-y-6 overflow-visible sm:px-8 sm:py-6 lg:px-12 lg:py-8'>
        <PageHeader
          action={
            <ActionLink href='/'>
              返回首页
              <ChevronRight className='h-4 w-4 rotate-180' />
            </ActionLink>
          }
          subtitle='集中管理当前账号的播放进度，支持单条删除、复选批量删除和清空全部。'
          title='播放历史'
        />

        <section className='space-y-4'>
          <SectionHeader
            action={
              items.length > 0 ? (
                <button
                  className='inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ui-critical)/0.38)] bg-[rgb(var(--ui-critical)/0.12)] px-3 py-1.5 text-sm font-medium text-[rgb(var(--ui-critical))] transition hover:bg-[rgb(var(--ui-critical)/0.18)] disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={busy}
                  onClick={handleClearAll}
                  type='button'
                >
                  <Trash2 className='h-4 w-4' />
                  清空全部
                </button>
              ) : null
            }
            subtitle={
              items.length > 0
                ? `共 ${items.length} 条，已选 ${selectedCount} 条`
                : undefined
            }
            title='历史记录'
          />

          {items.length > 0 ? (
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-ui-md border border-[rgb(var(--ui-border)/0.22)] bg-[rgb(var(--ui-surface)/0.16)] px-3 py-3 backdrop-blur-sm'>
              <button
                className='inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm font-medium text-[rgb(var(--ui-text-muted))] transition hover:text-[rgb(var(--ui-text))]'
                disabled={busy}
                onClick={toggleSelectAll}
                type='button'
              >
                {allSelected ? (
                  <CheckSquare className='h-4 w-4 text-[rgb(var(--ui-accent))]' />
                ) : (
                  <Square className='h-4 w-4' />
                )}
                {allSelected ? '取消全选' : '全选'}
              </button>

              <button
                className='inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ui-critical)/0.34)] bg-[rgb(var(--ui-critical)/0.1)] px-3 py-1.5 text-sm font-medium text-[rgb(var(--ui-critical))] transition hover:bg-[rgb(var(--ui-critical)/0.16)] disabled:cursor-not-allowed disabled:opacity-50'
                disabled={busy || selectedCount === 0}
                onClick={handleDeleteSelected}
                type='button'
              >
                <Trash2 className='h-4 w-4' />
                删除已选
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
              {Array.from({ length: 8 }).map((_, index) => (
                <SkeletonPosterCard
                  key={index}
                  delayIndex={index}
                  widths={['80%', '56%']}
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className='rounded-ui-md border border-[rgb(var(--ui-border)/0.22)] bg-[rgb(var(--ui-surface)/0.14)] px-4 py-12 text-center text-[rgb(var(--ui-text-muted))] backdrop-blur-sm'>
              暂无播放历史
            </div>
          ) : (
            <div className='space-y-3'>
              {items.map((item) => {
                const selected = selectedKeys.has(item.key);
                return (
                  <div
                    key={item.key}
                    className='grid grid-cols-[auto_4.5rem_1fr] items-center gap-3 rounded-ui-md border border-[rgb(var(--ui-border)/0.2)] bg-[rgb(var(--ui-surface)/0.16)] p-3 backdrop-blur-sm transition hover:border-[rgb(var(--ui-accent)/0.28)] hover:bg-[rgb(var(--ui-surface-strong)/0.28)] sm:grid-cols-[auto_5.5rem_1fr_auto]'
                  >
                    <button
                      aria-label={selected ? '取消选择' : '选择播放记录'}
                      className='inline-flex h-9 w-9 items-center justify-center rounded-full text-[rgb(var(--ui-text-muted))] transition hover:bg-[rgb(var(--ui-surface-strong)/0.32)] hover:text-[rgb(var(--ui-text))]'
                      disabled={busy}
                      onClick={() => toggleSelection(item.key)}
                      type='button'
                    >
                      {selected ? (
                        <CheckSquare className='h-5 w-5 text-[rgb(var(--ui-accent))]' />
                      ) : (
                        <Square className='h-5 w-5' />
                      )}
                    </button>

                    <button
                      aria-label={`继续播放 ${item.title}`}
                      className='relative aspect-[2/3] overflow-hidden rounded-ui-sm bg-[rgb(var(--ui-surface-strong)/0.32)] text-left'
                      onClick={() => router.push(buildPlayHref(item))}
                      type='button'
                    >
                      {item.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=''
                          className='h-full w-full object-cover'
                          src={item.cover}
                        />
                      ) : (
                        <div className='flex h-full w-full items-center justify-center px-2 text-center text-xs text-[rgb(var(--ui-text-muted))]'>
                          {item.title}
                        </div>
                      )}
                    </button>

                    <div className='min-w-0'>
                      <button
                        className='block max-w-full truncate text-left text-base font-semibold text-[rgb(var(--ui-text))] transition hover:text-[rgb(var(--ui-accent))]'
                        onClick={() => router.push(buildPlayHref(item))}
                        type='button'
                      >
                        {item.title}
                      </button>
                      <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[rgb(var(--ui-text-muted))]'>
                        <span>{item.source_name}</span>
                        {item.year ? <span>{item.year}</span> : null}
                        <span>
                          {item.total_episodes > 1
                            ? `第 ${item.index}/${item.total_episodes} 集`
                            : '电影'}
                        </span>
                      </div>
                      <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[rgb(var(--ui-text-muted))]'>
                        <span className='inline-flex items-center gap-1'>
                          <Clock3 className='h-3.5 w-3.5' />
                          {formatDate(item.save_time)}
                        </span>
                        <span>{formatProgress(item)}</span>
                      </div>
                    </div>

                    <div className='col-span-3 flex items-center justify-end gap-2 sm:col-span-1 sm:flex-col sm:items-stretch'>
                      <button
                        className='inline-flex items-center justify-center gap-2 rounded-full bg-[rgb(var(--ui-accent))] px-3 py-2 text-sm font-semibold text-[rgb(var(--ui-on-accent))] transition hover:brightness-110'
                        onClick={() => router.push(buildPlayHref(item))}
                        type='button'
                      >
                        <Play className='h-4 w-4' />
                        继续播放
                      </button>
                      <button
                        className='inline-flex items-center justify-center gap-2 rounded-full border border-[rgb(var(--ui-critical)/0.32)] px-3 py-2 text-sm font-medium text-[rgb(var(--ui-critical))] transition hover:bg-[rgb(var(--ui-critical)/0.12)] disabled:cursor-not-allowed disabled:opacity-50'
                        disabled={busy}
                        onClick={() => handleDeleteOne(item)}
                        type='button'
                      >
                        <Trash2 className='h-4 w-4' />
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </PageLayout>
  );
}
