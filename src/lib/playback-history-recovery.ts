import { selectRecoveryCandidate } from '@/lib/source-availability/index';
import type { SearchResult, SourceStatus } from '@/lib/types';

import { getRewoundPlaybackResumeTime } from './playback-source-switch';
import { buildWatchProgressContentKey } from './watch-progress';

export interface PlaybackHistoryRecord {
  index: number;
  play_time: number;
  total_time?: number;
  title?: string;
  year?: string;
}

interface ResolvePlaybackHistoryRecoveryInput {
  currentSource: string;
  currentId: string;
  searchResults: SearchResult[];
  detailResults: SearchResult[];
  isFromPlayRecord: boolean;
  historyRecord?: PlaybackHistoryRecord | null;
  /** Explicit URL episode (0-based). Null/undefined = omitted from URL. */
  urlEpisodeIndex?: number | null;
  contentKey?: string | null;
  sourceStatuses?: Map<string, SourceStatus>;
}

interface ResolvePlaybackHistoryRecoveryResult {
  detail: SearchResult | null;
  sources: SearchResult[];
  fellBackFromHistory: boolean;
  contentKey: string | null;
  resumeEpisodeIndex: number | null;
  resumeTime: number | null;
  error: string | null;
}

function isRequestedSource(
  source: SearchResult,
  currentSource: string,
  currentId: string
) {
  return source.source === currentSource && source.id === currentId;
}

function resolveResumeEpisodeIndex(
  detail: SearchResult,
  historyRecord?: PlaybackHistoryRecord | null,
  urlEpisodeIndex?: number | null
): number | null {
  // Episode authority lives on the play record when the URL omits episode.
  if (
    (urlEpisodeIndex === null || urlEpisodeIndex === undefined) &&
    historyRecord
  ) {
    const fromRecord = historyRecord.index - 1;
    if (fromRecord >= 0 && fromRecord < detail.episodes.length) {
      return fromRecord;
    }
    if (detail.episodes.length > 0) {
      return Math.min(Math.max(0, fromRecord), detail.episodes.length - 1);
    }
    return null;
  }

  if (urlEpisodeIndex != null) {
    if (urlEpisodeIndex >= 0 && urlEpisodeIndex < detail.episodes.length) {
      return urlEpisodeIndex;
    }
    if (detail.episodes.length > 0) {
      return Math.min(urlEpisodeIndex, detail.episodes.length - 1);
    }
    return null;
  }

  if (!historyRecord) {
    return null;
  }

  const targetIndex = historyRecord.index - 1;
  if (targetIndex < 0 || targetIndex >= detail.episodes.length) {
    return detail.episodes.length > 0 ? 0 : null;
  }

  return targetIndex;
}

function getResumePosition(
  detail: SearchResult,
  historyRecord?: PlaybackHistoryRecord | null,
  urlEpisodeIndex?: number | null
) {
  const resumeEpisodeIndex = resolveResumeEpisodeIndex(
    detail,
    historyRecord,
    urlEpisodeIndex
  );

  if (resumeEpisodeIndex == null || !historyRecord) {
    return {
      resumeEpisodeIndex,
      resumeTime: null,
    };
  }

  const historyEpisodeIndex = historyRecord.index - 1;
  if (historyEpisodeIndex !== resumeEpisodeIndex) {
    // Downgraded episode after missing target — start fresh on the fallback episode.
    return {
      resumeEpisodeIndex,
      resumeTime: null,
    };
  }

  const adapted = historyRecord.play_time;

  return {
    resumeEpisodeIndex,
    resumeTime: getRewoundPlaybackResumeTime(adapted) ?? 0,
  };
}

export function resolvePlaybackHistoryRecovery({
  currentSource,
  currentId,
  searchResults,
  detailResults,
  isFromPlayRecord,
  historyRecord,
  urlEpisodeIndex,
  contentKey: contentKeyInput,
  sourceStatuses,
}: ResolvePlaybackHistoryRecoveryInput): ResolvePlaybackHistoryRecoveryResult {
  const searchMatch = searchResults.find((source) =>
    isRequestedSource(source, currentSource, currentId)
  );
  const detailMatch =
    detailResults.find((source) =>
      isRequestedSource(source, currentSource, currentId)
    ) || detailResults[0];
  const fallbackDetail =
    isFromPlayRecord && searchResults.length > 0 ? searchResults[0] : null;

  let detail = searchMatch || detailMatch || fallbackDetail;
  if (!detail) {
    return {
      detail: null,
      sources: [],
      fellBackFromHistory: false,
      contentKey: contentKeyInput ?? null,
      resumeEpisodeIndex: null,
      resumeTime: null,
      error: '未找到匹配结果',
    };
  }

  let fellBackFromHistory: boolean =
    !searchMatch && !detailMatch && !!fallbackDetail;
  const sources = Array.from(
    new Map(
      [...detailResults, ...searchResults].map((source) => [
        JSON.stringify([source.source, source.id]),
        source,
      ])
    ).values()
  );
  const requestedEpisodeIndex =
    urlEpisodeIndex ?? (historyRecord ? historyRecord.index - 1 : 0);
  const missingRequestedEpisode = !detail.episodes[requestedEpisodeIndex];
  if (
    isFromPlayRecord &&
    (missingRequestedEpisode ||
      sourceStatuses?.get(`${detail.source}-${detail.id}`)?.kind ===
        'unavailable')
  ) {
    const alternate = selectRecoveryCandidate({
      sources,
      currentSourceKey: `${detail.source}-${detail.id}`,
      currentEpisodeIndex: requestedEpisodeIndex,
      statuses: sourceStatuses,
      allowUnverifiedFallback: true,
    });
    if (alternate) {
      detail = alternate.source;
      fellBackFromHistory = true;
    } else if (missingRequestedEpisode && (searchMatch || detailMatch)) {
      return {
        detail: null,
        sources,
        fellBackFromHistory: false,
        contentKey: contentKeyInput ?? null,
        resumeEpisodeIndex: null,
        resumeTime: null,
        error: `当前线路及候选暂未提供第 ${requestedEpisodeIndex + 1} 集`,
      };
    }
  }
  const contentKey =
    contentKeyInput ||
    buildWatchProgressContentKey({
      title: historyRecord?.title || detail.title,
      year: historyRecord?.year || detail.year,
    });
  const resumePosition = getResumePosition(
    detail,
    historyRecord,
    urlEpisodeIndex
  );

  return {
    detail,
    sources,
    fellBackFromHistory,
    contentKey,
    ...resumePosition,
    error: null,
  };
}
