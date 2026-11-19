import { useEffect, useState } from 'react';

import type { readPlaybackQualitySummary } from '@/lib/playback-quality.server';

type Qoe = NonNullable<
  Awaited<ReturnType<typeof readPlaybackQualitySummary>>
>['qoe'];

export default function PlaybackQualityMetrics() {
  const [days, setDays] = useState('7');
  const [cohort, setCohort] = useState('regular');
  const [refresh, setRefresh] = useState(0);
  const [qoe, setQoe] = useState<Qoe>(null);
  const [message, setMessage] = useState('正在读取统计…');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setQoe(null);
      setMessage('正在读取统计…');
      try {
        const response = await fetch(
          `/api/admin/playback-quality?days=${days}&cohort=${cohort}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok) throw new Error('读取播放质量统计失败');
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!payload.available || !payload.qoe)
          throw new Error('播放质量统计暂不可用');
        setQoe(payload.qoe);
        setMessage('');
      } catch (err) {
        if (!controller.signal.aborted)
          setMessage(
            err instanceof Error ? err.message : '读取播放质量统计失败'
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [days, cohort, refresh]);

  return (
    <section aria-label='播放质量统计' className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3 text-sm'>
        <label>
          会话分组{' '}
          <select
            className='ui-secondary-button ui-admin-compact'
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
          >
            <option value='regular'>普通会话</option>
            <option value='test'>测试会话</option>
          </select>
        </label>
        <label>
          统计周期{' '}
          <select
            className='ui-secondary-button ui-admin-compact'
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value='1'>今天</option>
            <option value='7'>近 7 天</option>
            <option value='30'>近 30 天</option>
          </select>
        </label>
        <button
          type='button'
          className='ui-secondary-button ui-admin-compact'
          onClick={() => setRefresh((v) => v + 1)}
        >
          刷新统计
        </button>
      </div>
      {message && <p role='status'>{message}</p>}
      {qoe && (
        <div className='grid gap-3 sm:grid-cols-2'>
          {[
            {
              name: '无中断播放率',
              rate: qoe.uninterruptedRate,
              detail: `前台连续播放满 5 分钟 / 可判定观看：${qoe.uninterruptedVisits} / ${qoe.observedVisits}`,
            },
            {
              name: '故障恢复成功率',
              rate: qoe.recoverySuccessRate,
              detail: `恢复成功 / 已判定故障：${qoe.recovered} / ${
                qoe.recovered + qoe.failed
              }`,
            },
          ].map(({ name, rate, detail }) => (
            <div
              key={name}
              className='rounded-lg border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] p-4'
            >
              <h4 className='text-sm font-medium'>{name}</h4>
              <p className='my-2 text-2xl font-semibold tabular-nums'>
                {rate === null
                  ? '暂无样本'
                  : rate.toLocaleString('zh-CN', {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    })}
              </p>
              <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
                {detail}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
