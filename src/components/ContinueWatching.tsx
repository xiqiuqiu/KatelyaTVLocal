/* eslint-disable no-console */
'use client';

import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  deletePlayRecord,
  getRecentPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { buildContinueWatchingRecords } from '@/lib/play-records';

import ScrollableRow from '@/components/ScrollableRow';
import ActionLink from '@/components/ui/ActionLink';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import SectionHeader from '@/components/ui/SectionHeader';
import VideoCard from '@/components/VideoCard';

const CONTINUE_WATCHING_RECORD_LIMIT = 50;

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string; groupedKeys: string[] })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const cardWidthClass =
    'w-24 min-w-[96px] min-[440px]:w-36 min-[440px]:min-w-[140px] sm:w-44 sm:min-w-[180px]';

  // 处理播放记录数据更新的函数
  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    setPlayRecords(buildContinueWatchingRecords(allRecords));
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);

        // 从缓存或API获取所有播放记录
        const allRecords = await getRecentPlayRecords(
          CONTINUE_WATCHING_RECORD_LIMIT
        );
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    // 监听播放记录更新事件
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  // 如果没有播放记录，则不渲染组件
  if (!loading && playRecords.length === 0) {
    return null;
  }

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const plusIndex = key.indexOf('+');
    const source = plusIndex >= 0 ? key.slice(0, plusIndex) : key;
    const id = plusIndex >= 0 ? key.slice(plusIndex + 1) : '';
    return { source, id };
  };

  return (
    <section className={`mb-8 ${className || ''}`}>
      <SectionHeader
        action={
          !loading && playRecords.length > 0 ? (
            <ActionLink href='/history'>
              更多
              <ChevronRight className='h-4 w-4' />
            </ActionLink>
          ) : null
        }
        className='mb-4'
        title='继续观看'
      />
      <ScrollableRow>
        {loading
          ? // 加载状态显示灰色占位数据
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cardWidthClass}>
                <SkeletonPosterCard
                  delayIndex={index}
                  widths={['84%', '62%']}
                />
              </div>
            ))
          : // 显示真实数据
            playRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              return (
                <div key={record.key} className={cardWidthClass}>
                  <VideoCard
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    source={source}
                    source_name={record.source_name}
                    progress={getProgress(record)}
                    episodes={record.total_episodes}
                    currentEpisode={record.index}
                    query={record.search_title}
                    from='playrecord'
                    onDeleteRecord={async () => {
                      const secondaryKeys = record.groupedKeys.filter(
                        (groupedKey) => groupedKey !== record.key
                      );
                      const keysToDelete = [...secondaryKeys, record.key];

                      for (const groupedKey of keysToDelete) {
                        const { source: groupedSource, id: groupedId } =
                          parseKey(groupedKey);
                        if (!groupedSource || !groupedId) {
                          continue;
                        }
                        await deletePlayRecord(groupedSource, groupedId);
                      }
                    }}
                    onDelete={() =>
                      setPlayRecords((prev) =>
                        prev.filter((r) => r.key !== record.key)
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : ''}
                  />
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}
