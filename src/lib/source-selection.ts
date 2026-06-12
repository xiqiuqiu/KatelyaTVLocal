import {
  SearchResult,
  SourceStatus,
  SourceStatusKind,
  SourceVideoInfo,
} from '@/lib/types';

export interface SourceSelectionScore {
  sourceKey: string;
  score: number;
  reason: string;
  statusKind?: SourceStatusKind;
  source: SearchResult;
  originalIndex: number;
}

interface BuildSourceSelectionScoresInput {
  sources: SearchResult[];
  statuses?: Map<string, SourceStatus>;
  measured?: Map<string, SourceVideoInfo>;
  currentEpisodeIndex: number;
  getSourceKey?: (source: SearchResult) => string;
}

function parseSpeedKbps(loadSpeed: string): number {
  const match = loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) {
    return 0;
  }

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return match[2] === 'MB/s' ? value * 1024 : value;
}

function getQualityScore(quality: string): number {
  switch (quality) {
    case '4K':
      return 100;
    case '2K':
      return 85;
    case '1080p':
      return 75;
    case '720p':
      return 60;
    case '480p':
      return 40;
    case 'SD':
      return 20;
    default:
      return 0;
  }
}

function getStatusBaseScore(statusKind?: SourceStatusKind): number {
  switch (statusKind) {
    case 'direct':
      return 80;
    case 'proxy':
      return 58;
    case 'playable':
      return 52;
    case 'unavailable':
      return -120;
    case 'probing':
    case 'idle':
    default:
      return 35;
  }
}

function getStatusReason(status?: SourceStatus | null): string {
  if (status?.reason) {
    return status.reason;
  }

  switch (status?.kind) {
    case 'direct':
      return '浏览器可直接播放';
    case 'proxy':
      return '建议代理播放';
    case 'playable':
      return '可尝试播放';
    case 'unavailable':
      return '该源当前不可用';
    default:
      return '待检测';
  }
}

export function calculateMeasuredSourceScore(
  testResult: Pick<SourceVideoInfo, 'quality' | 'loadSpeed' | 'pingTime'>,
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number {
  let score = 0;

  score += getQualityScore(testResult.quality) * 0.4;

  const speedKbps = parseSpeedKbps(testResult.loadSpeed);
  const speedScore =
    speedKbps > 0 && maxSpeed > 0
      ? Math.min(100, Math.max(0, (speedKbps / maxSpeed) * 100))
      : 30;
  score += speedScore * 0.4;

  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 0;
    if (maxPing === minPing) return 100;

    return Math.min(
      100,
      Math.max(0, ((maxPing - ping) / (maxPing - minPing)) * 100)
    );
  })();
  score += pingScore * 0.2;

  return Math.round(score * 100) / 100;
}

export function buildMeasuredScoreContext(measured: SourceVideoInfo[]): {
  maxSpeed: number;
  minPing: number;
  maxPing: number;
} {
  const validSpeeds = measured
    .filter((item) => !item.hasError)
    .map((item) => parseSpeedKbps(item.loadSpeed))
    .filter((speed) => speed > 0);
  const validPings = measured
    .filter((item) => !item.hasError)
    .map((item) => item.pingTime)
    .filter((ping) => ping > 0);

  return {
    maxSpeed: validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024,
    minPing: validPings.length > 0 ? Math.min(...validPings) : 50,
    maxPing: validPings.length > 0 ? Math.max(...validPings) : 1000,
  };
}

export function buildSourceSelectionScores({
  sources,
  statuses = new Map(),
  measured = new Map(),
  currentEpisodeIndex,
  getSourceKey = (source) => `${source.source}-${source.id}`,
}: BuildSourceSelectionScoresInput): Map<string, SourceSelectionScore> {
  const measuredValues = Array.from(measured.values()).filter(
    (item) => !item.hasError
  );
  const measuredContext = buildMeasuredScoreContext(measuredValues);
  const scores = new Map<string, SourceSelectionScore>();

  sources.forEach((source, originalIndex) => {
    const sourceKey = getSourceKey(source);
    const status = statuses.get(sourceKey);
    const info = measured.get(sourceKey);
    const hasCurrentEpisode =
      Boolean(source.episodes?.length) &&
      currentEpisodeIndex >= 0 &&
      currentEpisodeIndex < source.episodes.length;

    let score = getStatusBaseScore(status?.kind);
    if (typeof status?.rankScore === 'number') {
      score += Math.max(-50, Math.min(100, status.rankScore)) * 0.35;
    }
    if (status?.fromMemory) {
      score += 5;
    }
    if (!hasCurrentEpisode) {
      score -= 220;
    }

    if (info) {
      if (info.hasError) {
        score -= 45;
      } else {
        score +=
          calculateMeasuredSourceScore(
            info,
            measuredContext.maxSpeed,
            measuredContext.minPing,
            measuredContext.maxPing
          ) * 0.75;
      }
    }

    scores.set(sourceKey, {
      sourceKey,
      score: Number(score.toFixed(2)),
      reason: hasCurrentEpisode ? getStatusReason(status) : '不包含当前集',
      statusKind: status?.kind,
      source,
      originalIndex,
    });
  });

  return scores;
}

export function sortSourcesBySelectionScore(
  sources: SearchResult[],
  scores: Map<string, SourceSelectionScore>,
  getSourceKey: (source: SearchResult) => string = (source) =>
    `${source.source}-${source.id}`,
  currentSourceKey?: string | null
): SearchResult[] {
  return [...sources].sort((a, b) => {
    const aKey = getSourceKey(a);
    const bKey = getSourceKey(b);
    const aIsCurrent = Boolean(currentSourceKey) && aKey === currentSourceKey;
    const bIsCurrent = Boolean(currentSourceKey) && bKey === currentSourceKey;

    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;

    const aScore = scores.get(aKey);
    const bScore = scores.get(bKey);

    if (aScore && bScore && aScore.score !== bScore.score) {
      return bScore.score - aScore.score;
    }
    if (aScore && !bScore) return -1;
    if (!aScore && bScore) return 1;

    const aIndex = aScore?.originalIndex ?? sources.indexOf(a);
    const bIndex = bScore?.originalIndex ?? sources.indexOf(b);
    return aIndex - bIndex;
  });
}
