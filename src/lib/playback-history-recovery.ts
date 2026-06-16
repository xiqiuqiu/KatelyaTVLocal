import type { SearchResult } from '@/lib/types';

import { getRewoundPlaybackResumeTime } from './playback-source-switch';

export interface PlaybackHistoryRecord {
  index: number;
  play_time: number;
}

interface ResolvePlaybackHistoryRecoveryInput {
  currentSource: string;
  currentId: string;
  searchResults: SearchResult[];
  detailResults: SearchResult[];
  isFromPlayRecord: boolean;
  historyRecord?: PlaybackHistoryRecord | null;
}

interface ResolvePlaybackHistoryRecoveryResult {
  detail: SearchResult | null;
  sources: SearchResult[];
  fellBackFromHistory: boolean;
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

function getResumePosition(
  detail: SearchResult,
  historyRecord?: PlaybackHistoryRecord | null
) {
  if (!historyRecord) {
    return {
      resumeEpisodeIndex: null,
      resumeTime: null,
    };
  }

  const targetIndex = historyRecord.index - 1;
  if (targetIndex < 0 || targetIndex >= detail.episodes.length) {
    return {
      resumeEpisodeIndex: 0,
      resumeTime: null,
    };
  }

  return {
    resumeEpisodeIndex: targetIndex,
    resumeTime: getRewoundPlaybackResumeTime(historyRecord.play_time) ?? 0,
  };
}

export function resolvePlaybackHistoryRecovery({
  currentSource,
  currentId,
  searchResults,
  detailResults,
  isFromPlayRecord,
  historyRecord,
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

  const detail = searchMatch || detailMatch || fallbackDetail;
  if (!detail) {
    return {
      detail: null,
      sources: [],
      fellBackFromHistory: false,
      resumeEpisodeIndex: null,
      resumeTime: null,
      error: '未找到匹配结果',
    };
  }

  const fellBackFromHistory = !searchMatch && !detailMatch && !!fallbackDetail;
  const sources = detailMatch
    ? detailResults
    : searchResults.length > 0
    ? searchResults
    : [detail];
  const resumePosition = getResumePosition(detail, historyRecord);

  return {
    detail,
    sources,
    fellBackFromHistory,
    ...resumePosition,
    error: null,
  };
}
