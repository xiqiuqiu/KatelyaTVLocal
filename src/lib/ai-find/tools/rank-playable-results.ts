import {
  probeSourcePlaybackWithCache,
  sortSourcePreferenceResults,
} from '@/lib/source-preference';
import type { SearchResult, SourcePreferenceResult } from '@/lib/types';

import { mapWithConcurrency } from '../concurrency';

type RankPreference = 'stable' | 'fast' | 'quality';
const AI_FIND_PLAYBACK_PROBE_CONCURRENCY = 4;

export interface RankPlayableResultInputItem {
  sourceKey: string;
  id: string;
  episodeUrl: string | null;
}

export interface RankedPlayableResultItem extends SourcePreferenceResult {
  id: string;
  episodeUrl: string | null;
}

export interface RankedPlayableResults {
  orderedItems: RankedPlayableResultItem[];
  orderedSourceKeys: string[];
}

function normalizePreference(value: unknown): RankPreference {
  return value === 'fast' || value === 'quality' ? value : 'stable';
}

export function getPlaybackHintFromKind(
  kind: string | undefined
): 'direct' | 'proxy' | 'unknown' {
  if (kind === 'direct') return 'direct';
  if (kind === 'proxy') return 'proxy';
  return 'unknown';
}

export async function rankPlayableResults({
  items,
  origin,
  prefer,
}: {
  items: RankPlayableResultInputItem[];
  origin: string;
  prefer?: RankPreference;
}): Promise<RankedPlayableResults> {
  normalizePreference(prefer);

  const probedResults = await mapWithConcurrency(
    items,
    AI_FIND_PLAYBACK_PROBE_CONCURRENCY,
    async (item): Promise<RankedPlayableResultItem> => {
      const normalizedSourceKey = item.sourceKey.trim();

      if (!normalizedSourceKey) {
        return {
          sourceKey: '',
          id: item.id,
          episodeUrl: item.episodeUrl,
          kind: 'unavailable',
          reason: '缺少播放源标识',
        };
      }

      if (!item.episodeUrl) {
        return {
          sourceKey: normalizedSourceKey,
          id: item.id,
          episodeUrl: null,
          kind: 'unavailable',
          reason: '缺少可播放链接',
        };
      }

      try {
        const probeResult = await probeSourcePlaybackWithCache(
          item.episodeUrl,
          origin
        );

        return {
          sourceKey: normalizedSourceKey,
          id: item.id,
          episodeUrl: item.episodeUrl,
          ...probeResult,
        };
      } catch (error) {
        return {
          sourceKey: normalizedSourceKey,
          id: item.id,
          episodeUrl: item.episodeUrl,
          kind: 'unavailable',
          reason: error instanceof Error ? error.message : '播放源探测失败',
        };
      }
    }
  );

  const orderedItems = sortSourcePreferenceResults(probedResults);

  return {
    orderedItems,
    orderedSourceKeys: orderedItems
      .map((item) => item.sourceKey)
      .filter(Boolean),
  };
}

export async function rankSearchResultGroupItems({
  items,
  origin,
  prefer,
}: {
  items: SearchResult[];
  origin: string;
  prefer?: RankPreference;
}): Promise<{
  items: SearchResult[];
  playbackHint: 'direct' | 'proxy' | 'unknown';
}> {
  const ranking = await rankPlayableResults({
    items: items.map((item) => ({
      sourceKey: item.source,
      id: item.id,
      episodeUrl: item.episodes[0] || null,
    })),
    origin,
    prefer,
  });

  const orderMap = new Map<string, number>();
  ranking.orderedItems.forEach((item, index) => {
    orderMap.set(`${item.sourceKey}:${item.id}`, index);
  });

  const orderedSearchItems = [...items].sort((a, b) => {
    const aIndex =
      orderMap.get(`${a.source}:${a.id}`) ?? Number.MAX_SAFE_INTEGER;
    const bIndex =
      orderMap.get(`${b.source}:${b.id}`) ?? Number.MAX_SAFE_INTEGER;

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    return a.source.localeCompare(b.source);
  });

  return {
    items: orderedSearchItems,
    playbackHint: getPlaybackHintFromKind(ranking.orderedItems[0]?.kind),
  };
}

export const rankPlayableResultsToolSchema = {
  type: 'function' as const,
  function: {
    name: 'rank_playable_results',
    description:
      'Rank KatelyaTV source results so direct playback is preferred over proxy and unavailable sources.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          description:
            'Candidate KatelyaTV source results to rank for playback.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceKey: {
                type: 'string',
              },
              id: {
                type: 'string',
              },
              episodeUrl: {
                type: ['string', 'null'],
              },
            },
            required: ['sourceKey', 'id', 'episodeUrl'],
          },
        },
        prefer: {
          type: 'string',
          enum: ['stable', 'fast', 'quality'],
          description: 'Preferred playback strategy.',
        },
      },
      required: ['items'],
    },
  },
};
