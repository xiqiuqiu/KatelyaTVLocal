/* eslint-disable no-console */

import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { parsePlayRecordKey } from '@/lib/play-record-key';
import {
  isAuthorizedCronRequest,
  readCronApiToken,
} from '@/lib/source-ranking/cron-auth';
import {
  runLowFrequencySourceRankingCheck,
  SourceRankingSchedulerEnvLike,
} from '@/lib/source-ranking/scheduler';

const CRON_RECENT_PLAY_RECORD_LIMIT = 50;
const CRON_RECENT_FAVORITE_LIMIT = 50;
import { SearchResult } from '@/lib/types';

export const runtime = 'edge';

type RuntimeSource = Record<string, unknown>;

function readFlag(source: RuntimeSource, key: string, defaultValue = false) {
  const value = source[key];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value === 'true';
  }

  return defaultValue;
}

function hasDbBinding(source: RuntimeSource) {
  const value = source.DB;
  return (
    value &&
    typeof value === 'object' &&
    typeof (value as SourceRankingSchedulerEnvLike['DB'])?.prepare ===
      'function'
  );
}

function resolveSourceRankingEnv(): RuntimeSource | undefined {
  try {
    const requestContext = getOptionalRequestContext();
    return requestContext?.env as RuntimeSource | undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const rankingEnv =
    resolveSourceRankingEnv() || (process.env as unknown as RuntimeSource);

  if (!isAuthorizedCronRequest(request, rankingEnv)) {
    if (!readCronApiToken(rankingEnv)) {
      console.error('Cron API rejected: CRON_API_TOKEN is not configured');
    } else {
      console.error('Cron API rejected: unauthorized request');
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Unauthorized',
      },
      { status: 401 }
    );
  }

  console.log(request.url);
  try {
    console.log('Cron job triggered:', new Date().toISOString());

    const refreshPromise = refreshRecordAndFavorites();
    const sourceRanking = await tryRunSourceRankingCron(request, rankingEnv);

    await refreshPromise;

    return NextResponse.json({
      success: true,
      message: 'Cron job executed successfully',
      timestamp: new Date().toISOString(),
      sourceRanking,
    });
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

function shouldRunSourceRankingCron(source: RuntimeSource) {
  return (
    readFlag(source, 'SOURCE_RANKING_CRON_ENABLED') && hasDbBinding(source)
  );
}

async function tryRunSourceRankingCron(
  request: NextRequest,
  rankingEnv: RuntimeSource
) {
  if (!shouldRunSourceRankingCron(rankingEnv)) {
    return {
      attempted: false,
      reason: 'disabled or missing D1 binding',
    };
  }

  try {
    const result = await runLowFrequencySourceRankingCheck({
      env: rankingEnv as SourceRankingSchedulerEnvLike,
      origin: new URL(request.url).origin,
      triggerType: 'cron',
    });

    return {
      attempted: true,
      status: result.status,
      runId: result.runId,
      sampledRecordCount: result.sampledRecordCount,
      taskCount: result.taskCount,
      probeCount: result.probeCount,
      snapshotCount: result.snapshotCount,
      errorCount: result.errorCount,
      reason: result.reason,
    };
  } catch (error) {
    console.error('播放源优选体检执行失败:', error);

    return {
      attempted: true,
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function refreshRecordAndFavorites() {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    console.log('跳过刷新：当前使用 localstorage 存储模式');
    return;
  }

  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            // 成功时才缓存结果
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
      }
      return promise;
    };

    for (const user of users) {
      console.log(`开始处理用户: ${user}`);

      // 播放记录
      try {
        const playRecords = await db.getRecentPlayRecords(
          user,
          CRON_RECENT_PLAY_RECORD_LIMIT
        );
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const parsedKey = parsePlayRecordKey(key);
            if (!parsedKey) {
              console.warn(`跳过无效的播放记录键: ${key}`);
              continue;
            }
            const { source, id } = parsedKey;

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`跳过无法获取详情的播放记录: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              console.log(
                `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败 (${key}):`, err);
            // 继续处理下一个记录
          }
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      // 收藏
      try {
        const allFavorites = await db.getAllFavorites(user);
        const favorites = Object.fromEntries(
          Object.entries(allFavorites)
            .sort(([, left], [, right]) => right.save_time - left.save_time)
            .slice(0, CRON_RECENT_FAVORITE_LIMIT)
        );
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const parsedKey = parsePlayRecordKey(key);
            if (!parsedKey) {
              console.warn(`跳过无效的收藏键: ${key}`);
              continue;
            }
            const { source, id } = parsedKey;

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`跳过无法获取详情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            console.error(`处理收藏失败 (${key}):`, err);
            // 继续处理下一个收藏
          }
        }

        console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`获取用户收藏失败 (${user}):`, err);
      }
    }

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}
