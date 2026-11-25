import { useEffect, useState } from 'react';

import type {
  readPlaybackDashboard,
  readSourceRankingExperiment,
} from '@/lib/playback-quality.server';
import { SOURCE_RANKING_EXPERIMENT_POLICIES } from '@/lib/source-ranking/experiment';

type Summary = NonNullable<Awaited<ReturnType<typeof readPlaybackDashboard>>>;
type ExperimentRow = NonNullable<
  Awaited<ReturnType<typeof readSourceRankingExperiment>>
>['experiment'][number];

const startupLabels = {
  started: '成功起播',
  failed: '起播失败',
  waiting: '等待首帧',
  ended: '起播已结束',
  unconfirmed: '未确认首帧',
};

function formatSampleRate(count: number, total: number) {
  if (!total) return '暂无样本';
  const rate = (count / total).toLocaleString('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  return `${rate}（${count} / ${total}）`;
}

function SourceRankingComparison({
  days,
  cohort,
}: {
  days: string;
  cohort: string;
}) {
  const [rows, setRows] = useState<ExperimentRow[] | 'unavailable' | null>(
    null
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/admin/playback-quality?days=${days}&cohort=${cohort}&view=ranking-experiment`,
      { signal: controller.signal, cache: 'no-store' }
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!controller.signal.aborted)
          setRows(
            payload?.available && Array.isArray(payload.experiment)
              ? payload.experiment
              : 'unavailable'
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setRows('unavailable');
      });
    return () => controller.abort();
  }, [days, cohort]);

  if (rows === 'unavailable') return <p role='status'>线路排名对比暂不可用</p>;
  if (!rows) return <p role='status'>正在读取线路排名对比…</p>;
  if (rows.length === 0) return <p role='status'>暂无线路排名对比样本</p>;

  return (
    <>
      <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
        按账号固定分组，仅统计有多条候选的首次自动选线。首条线路成功率按已判定结果计算，点击耗时仅计同一轮已确认首帧的前台点击样本。
      </p>
      <div
        className='overflow-x-auto'
        role='region'
        aria-label='线路排名对比'
        tabIndex={0}
      >
        <table className='w-full text-left text-sm'>
          <thead>
            <tr>
              {[
                '组别',
                '账号 / 起播',
                '首条线路成功率',
                '点击到首帧 P95',
                '无中断播放率',
                '故障恢复成功率',
              ].map((label) => (
                <th className='p-2' key={label} scope='col'>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                name: '对照组 · 不使用 Cron 排名',
                policy: SOURCE_RANKING_EXPERIMENT_POLICIES.control,
              },
              {
                name: '实验组 · 使用 Cron 排名',
                policy: SOURCE_RANKING_EXPERIMENT_POLICIES.ranking,
              },
            ].map(({ name, policy }) => {
              const row = rows.find((item) => item.policyVersion === policy);
              return (
                <tr key={policy}>
                  <th className='p-2 font-medium' scope='row'>
                    {name}
                  </th>
                  <td className='p-2'>
                    {row?.accounts ?? 0} / {row?.starts ?? 0}
                  </td>
                  <td className='p-2'>
                    {formatSampleRate(
                      row?.firstSourceSuccesses ?? 0,
                      row?.decidedStarts ?? 0
                    )}
                  </td>
                  <td className='p-2'>
                    {row && row.clickP95Ms !== null
                      ? `${(row.clickP95Ms / 1000).toFixed(2)} 秒（${
                          row.clickSamples
                        }）`
                      : '暂无样本'}
                  </td>
                  <td className='p-2'>
                    {formatSampleRate(
                      row?.uninterruptedVisits ?? 0,
                      row?.observedVisits ?? 0
                    )}
                  </td>
                  <td className='p-2'>
                    {formatSampleRate(
                      row?.recovered ?? 0,
                      (row?.recovered ?? 0) + (row?.failed ?? 0)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PlaybackQualityMetrics() {
  const [days, setDays] = useState('7');
  const [cohort, setCohort] = useState('regular');
  const [refresh, setRefresh] = useState(0);
  const [stats, setStats] = useState<Summary | null>(null);
  const [showRanking, setShowRanking] = useState(false);
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
      <section className='space-y-2' aria-label='Cron 线路排名实验'>
        <button
          className='ui-secondary-button ui-admin-compact'
          type='button'
          aria-expanded={showRanking}
          onClick={() => setShowRanking((shown) => !shown)}
        >
          {showRanking ? '收起线路排名对比' : '查看线路排名对比'}
        </button>
        {showRanking && (
          <SourceRankingComparison
            key={`${days}/${cohort}/${refresh}`}
            days={days}
            cohort={cohort}
          />
        )}
      </section>
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
                        {startupLabels[visit.startupStatus]}
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
