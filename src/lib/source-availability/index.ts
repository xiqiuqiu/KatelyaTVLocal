import {
  sortSourcesBySelectionScore,
  SourceSelectionScore,
} from '../source-selection';
import type { SearchResult, SourceStatus, SourceVideoInfo } from '../types';
import { getSourceIdentityKey } from '../utils';

export type ManualSwitchMode = 'switch-now' | 'probe-first' | 'blocked';

export type AvailabilityKind =
  | 'current'
  | 'direct'
  | 'playable'
  | 'unknown'
  | 'probing'
  | 'proxy-required'
  | 'unavailable'
  | 'episode-missing';

export type AvailabilityEvidenceKind =
  | 'current-source'
  | 'browser-direct'
  | 'backend-playable'
  | 'remembered-direct'
  | 'remembered-unavailable'
  | 'probe-pending'
  | 'probe-failed-but-tryable'
  | 'episode-missing'
  | 'proxy-required'
  | 'unknown';

export interface SourceAvailabilityDecision {
  mode: ManualSwitchMode;
  reason: string;
}

export interface SourceAutoRecoveryDecision {
  eligible: boolean;
  reason: string;
  rank: number;
}

export interface SourceAvailabilityEpisode {
  exists: boolean;
  url: string | null;
  reason?: string;
}

export interface SourceAvailabilityItem {
  source: SearchResult;
  sourceKey: string;
  isCurrent: boolean;
  orderIndex: number;
  availabilityKind: AvailabilityKind;
  evidenceKind: AvailabilityEvidenceKind;
  effectiveStatus?: SourceStatus;
  measured?: SourceVideoInfo;
  episode: SourceAvailabilityEpisode;
  manualSwitch: SourceAvailabilityDecision;
  autoRecovery: SourceAutoRecoveryDecision;
}

export interface BuildSourceAvailabilityListInput {
  sources: SearchResult[];
  currentSourceKey?: string | null;
  currentEpisodeIndex: number;
  statuses?: Map<string, SourceStatus>;
  measured?: Map<string, SourceVideoInfo>;
  sourceSelectionScores?: Map<string, SourceSelectionScore>;
}

export type SelectRecoveryCandidateInput = BuildSourceAvailabilityListInput & {
  attemptedSourceKeys?: Set<string>;
  /**
   * When no verified (direct/playable) candidate exists, allow unknown/probing
   * sources that still have the current episode. Used for startup hang / source
   * timeout so playback is not stuck waiting for evidence that never arrives.
   */
  allowUnverifiedFallback?: boolean;
};

function hasBackendPlayableMetrics(info: SourceVideoInfo | undefined): boolean {
  return Boolean(
    info &&
      !info.hasError &&
      info.speedSource === 'backend' &&
      !info.speedPending
  );
}

function getEffectiveStatus(
  status: SourceStatus | undefined,
  measured: SourceVideoInfo | undefined
): SourceStatus | undefined {
  if (status?.kind === 'unavailable' && hasBackendPlayableMetrics(measured)) {
    return {
      kind: 'playable',
      reason: '后端测速可用，可尝试播放',
      playbackMode: status.playbackMode || 'direct',
      domain: status.domain || null,
      measured,
      updatedAt: Math.max(status.updatedAt || 0, measured?.speedUpdatedAt || 0),
      rankingSource: status.rankingSource,
      rankScore: status.rankScore,
    };
  }

  return status;
}

function getEvidenceKind(
  status: SourceStatus | undefined,
  measured: SourceVideoInfo | undefined
): AvailabilityEvidenceKind {
  if (status?.kind === 'direct') {
    return status.fromMemory ? 'remembered-direct' : 'browser-direct';
  }

  if (status?.kind === 'playable') {
    return hasBackendPlayableMetrics(measured)
      ? 'backend-playable'
      : 'probe-failed-but-tryable';
  }

  if (status?.kind === 'probing') {
    return 'probe-pending';
  }

  if (status?.kind === 'proxy') {
    return 'proxy-required';
  }

  if (status?.kind === 'unavailable') {
    return status.fromMemory ? 'remembered-unavailable' : 'unknown';
  }

  return 'unknown';
}

function getAvailabilityKind(
  isCurrent: boolean,
  episode: SourceAvailabilityEpisode,
  status: SourceStatus | undefined
): AvailabilityKind {
  if (isCurrent) return 'current';
  if (!episode.exists) return 'episode-missing';

  switch (status?.kind) {
    case 'direct':
      return 'direct';
    case 'playable':
      return 'playable';
    case 'probing':
      return 'probing';
    case 'proxy':
      return 'proxy-required';
    case 'unavailable':
      return 'unavailable';
    case 'idle':
    default:
      return 'unknown';
  }
}

function getManualSwitchDecision(
  availabilityKind: AvailabilityKind,
  status: SourceStatus | undefined
): SourceAvailabilityDecision {
  switch (availabilityKind) {
    case 'current':
      return { mode: 'blocked', reason: '当前正在播放此线路' };
    case 'episode-missing':
      return { mode: 'blocked', reason: '当前集不可用' };
    case 'proxy-required':
      return { mode: 'blocked', reason: '当前播放路径未启用代理播放' };
    case 'unavailable':
      return {
        mode: 'blocked',
        reason: status?.reason || '该线路当前不可用',
      };
    case 'unknown':
      return { mode: 'probe-first', reason: '等待检测线路状态' };
    case 'probing':
      return {
        mode: 'switch-now',
        reason: status?.reason || '检测中，可尝试播放',
      };
    case 'direct':
    case 'playable':
    default:
      return { mode: 'switch-now', reason: status?.reason || '可尝试播放' };
  }
}

function getAutoRecoveryDecision(
  availabilityKind: AvailabilityKind,
  status: SourceStatus | undefined,
  orderIndex: number
): SourceAutoRecoveryDecision {
  switch (availabilityKind) {
    case 'direct':
    case 'playable':
      return {
        eligible: true,
        reason: status?.reason || '可用于自动恢复',
        rank: orderIndex,
      };
    case 'current':
      return {
        eligible: false,
        reason: '当前正在播放此线路',
        rank: Number.MAX_SAFE_INTEGER,
      };
    case 'episode-missing':
      return {
        eligible: false,
        reason: '当前集不可用',
        rank: Number.MAX_SAFE_INTEGER,
      };
    case 'proxy-required':
      return {
        eligible: false,
        reason: '当前播放路径未启用代理播放',
        rank: Number.MAX_SAFE_INTEGER,
      };
    case 'unavailable':
      return {
        eligible: false,
        reason: status?.reason || '该线路当前不可用',
        rank: Number.MAX_SAFE_INTEGER,
      };
    case 'unknown':
    case 'probing':
    default:
      return {
        eligible: false,
        reason: '自动恢复需要更明确的播放证据',
        rank: Number.MAX_SAFE_INTEGER,
      };
  }
}

export function buildSourceAvailabilityList({
  sources,
  currentSourceKey = null,
  currentEpisodeIndex,
  statuses = new Map(),
  measured = new Map(),
  sourceSelectionScores = new Map(),
}: BuildSourceAvailabilityListInput): SourceAvailabilityItem[] {
  const sortedSources = sortSourcesBySelectionScore(
    sources,
    sourceSelectionScores,
    (source) => getSourceIdentityKey(source.source, source.id),
    currentSourceKey || undefined
  );

  return sortedSources.map((source, orderIndex) => {
    const sourceKey = getSourceIdentityKey(source.source, source.id);
    const measuredInfo = measured.get(sourceKey);
    const effectiveStatus = getEffectiveStatus(
      statuses.get(sourceKey),
      measuredInfo
    );
    const episodeUrl = source.episodes?.[currentEpisodeIndex] || null;
    const episode: SourceAvailabilityEpisode = episodeUrl
      ? { exists: true, url: episodeUrl }
      : { exists: false, url: null, reason: '当前集不可用' };
    const isCurrent = sourceKey === currentSourceKey;
    const availabilityKind = getAvailabilityKind(
      isCurrent,
      episode,
      effectiveStatus
    );
    const manualSwitch = getManualSwitchDecision(
      availabilityKind,
      effectiveStatus
    );
    const autoRecovery = getAutoRecoveryDecision(
      availabilityKind,
      effectiveStatus,
      orderIndex
    );

    return {
      source,
      sourceKey,
      isCurrent,
      orderIndex,
      availabilityKind,
      evidenceKind: episode.exists
        ? getEvidenceKind(effectiveStatus, measuredInfo)
        : 'episode-missing',
      effectiveStatus,
      measured: measuredInfo,
      episode,
      manualSwitch,
      autoRecovery,
    };
  });
}

function pickAutoRecoveryCandidate(
  items: SourceAvailabilityItem[],
  attempted: Set<string>
): SourceAvailabilityItem | null {
  return (
    items
      .filter(
        (item) =>
          item.autoRecovery.eligible &&
          !item.isCurrent &&
          !attempted.has(item.sourceKey)
      )
      .sort(
        (left, right) => left.autoRecovery.rank - right.autoRecovery.rank
      )[0] || null
  );
}

function pickUnverifiedStartupFallbackCandidate(
  items: SourceAvailabilityItem[],
  attempted: Set<string>
): SourceAvailabilityItem | null {
  return (
    items
      .filter(
        (item) =>
          !item.isCurrent &&
          !attempted.has(item.sourceKey) &&
          item.episode.exists &&
          (item.availabilityKind === 'unknown' ||
            item.availabilityKind === 'probing')
      )
      .sort((left, right) => left.orderIndex - right.orderIndex)[0] || null
  );
}

export function selectRecoveryCandidate(
  input: SelectRecoveryCandidateInput
): SourceAvailabilityItem | null {
  const attempted = input.attemptedSourceKeys || new Set<string>();
  const items = buildSourceAvailabilityList(input);
  const verified = pickAutoRecoveryCandidate(items, attempted);
  if (verified) {
    return verified;
  }

  if (!input.allowUnverifiedFallback) {
    return null;
  }

  return pickUnverifiedStartupFallbackCandidate(items, attempted);
}

export {
  clearAttemptedLedgersOnEpisodeChange,
  clearAttemptedLedgersOnTitleChange,
} from './attempted-ledgers';
export type { SourceAttemptedLedgers } from './attempted-ledgers';
export {
  getSourceCandidateAuthorityMode,
  isSourceAvailabilityCandidateAuthorityEnabled,
  resolveRecoveryCandidateSource,
} from './authority';
export type {
  ResolveRecoveryCandidateSourceInput,
  SourceCandidateAuthorityMode,
} from './authority';
