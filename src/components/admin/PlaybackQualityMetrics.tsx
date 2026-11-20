import { useEffect, useState } from 'react';

import type { readPlaybackDashboard } from '@/lib/playback-quality.server';

type Summary = NonNullable<Awaited<ReturnType<typeof readPlaybackDashboard>>>;

export default function PlaybackQualityMetrics() {
  const [days, setDays] = useState('7');
  const [cohort, setCohort] = useState('regular');
  const [refresh, setRefresh] = useState(0);
  const [stats, setStats] = useState<Summary | null>(null);
  const { qoe, banner, playback } = stats ?? {};
  const [message, setMessage] = useState('正在读取统计…');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setStats(null);
      setMessage('正在读取统计…');
      try {
        const response = await fetch(
          `/api/admin/playback-quality?days=${days}&cohort=${cohort}&view=dashboard`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok) throw new Error('读取播放质量统计失败');
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!payload.available || !payload.qoe)
          throw new Error('播放质量统计暂不可用');
        setStats(payload);
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
            ...(banner
              ? [
                  {
                    name: 'Banner 点击率',
                    rate: banner.impressions
                      ? banner.clicks / banner.impressions
                      : null,
                    detail: `点击 / 可见首页访问：${banner.clicks} / ${banner.impressions}`,
                  },
                  {
                    name: '点击后看满 5 分钟率',
                    rate: banner.clicks ? banner.watched / banner.clicks : null,
                    detail: `所点作品前台累计满 5 分钟 / 点击：${banner.watched} / ${banner.clicks}`,
                  },
                ]
              : []),
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
      {playback && (
        <section aria-label='用户播放记录' className='space-y-2'>
          <h4 className='font-semibold'>用户播放记录</h4>
          <p>
            成功起播 {playback.successful} 次 / 共 {playback.total} 次播放
          </p>
          <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
            按播放首帧确认成功，同一次起播的线路重试只计一次。列表显示最近 30
            次。
          </p>
          {playback.visits.length === 0 ? (
            <p>暂无播放记录</p>
          ) : (
            <div
              className='overflow-x-auto'
              role='region'
              aria-label='最近播放记录'
              tabIndex={0}
            >
              <table className='w-full text-left text-sm'>
                <thead>
                  <tr>
                    {[
                      '开始时间（台北）',
                      '用户',
                      '影片 / 集数',
                      '起播结果',
                      '成功线路',
                    ].map((label) => (
                      <th className='p-2' key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {playback.visits.map((visit, index) => (
                    <tr key={index}>
                      <td className='p-2'>
                        {new Date(visit.startedAt).toLocaleString('zh-CN', {
                          timeZone: 'Asia/Taipei',
                          hour12: false,
                        })}
                      </td>
                      <td className='p-2'>{visit.owner}</td>
                      <td className='p-2'>
                        {visit.contentKey?.replace(
                          /::(unknown|\d{4})$/,
                          (_, year) =>
                            year === 'unknown' ? '' : '（' + year + '）'
                        ) || '未知影片'}{' '}
                        · 第 {visit.episodeIndex + 1} 集
                      </td>
                      <td className='p-2'>
                        {visit.started ? '成功起播' : '尚未确认首帧'}
                      </td>
                      <td className='p-2'>{visit.sourceKey || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
