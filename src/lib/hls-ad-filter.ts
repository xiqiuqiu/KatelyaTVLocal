import {
  findKnownHlsAdRuleMatch,
  findKnownHlsAdSegmentRuleMatches,
  KnownHlsAdRuleMatch,
  KnownHlsAdRuleSegment,
  KnownHlsAdSegmentRuleMatch,
} from './hls-ad-rules';

const DISCONTINUITY_TAG = '#EXT-X-DISCONTINUITY';
const CUE_OUT_TAG = '#EXT-X-CUE-OUT';
const CUE_IN_TAG = '#EXT-X-CUE-IN';
const SCTE35_TAG = '#EXT-X-SCTE35';
const DATERANGE_TAG = '#EXT-X-DATERANGE';

const AD_URL_PATTERNS = [/\/ads?(?:[/_-]|$)/i, /advertisement/i, /commercial/i];

type AdBlockReason =
  | 'cue-marker'
  | 'scte35'
  | 'daterange'
  | 'url-keyword'
  | 'alternate-host'
  | 'known-rule'
  | 'foreign-path'
  | 'short-discontinuity';

export type M3U8AdCandidateConfidence = 'high' | 'medium' | 'low';
export type M3U8AdCandidateAction = 'filter' | 'observe' | 'protect';

export type M3U8AdCandidate = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  segmentIndexes: number[];
  segmentCount: number;
  reasons: AdBlockReason[];
  confidence: M3U8AdCandidateConfidence;
  action: M3U8AdCandidateAction;
  ruleId?: string;
  ruleName?: string;
  hosts: string[];
  sampleUrls: string[];
};

export type M3U8AdAnalysis = {
  candidates: M3U8AdCandidate[];
  summary: M3U8AdDebugSummary;
  filteredContent: string;
  removedLineCount: number;
};

export interface M3U8AdFilteringPolicy {
  minimumConfidence?: M3U8AdCandidateConfidence;
}

export type M3U8RemovedAdBlockInfo = {
  reason: AdBlockReason;
  reasons: AdBlockReason[];
  segmentCount: number;
  durationSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  hosts: string[];
  sampleUrls: string[];
  ruleId?: string;
  ruleName?: string;
};

export type M3U8AdDebugSummary = {
  totalLines: number;
  filteredLineCount: number;
  extinfCount: number;
  discontinuityCount: number;
  cueOutCount: number;
  cueInCount: number;
  scte35Count: number;
  daterangeCount: number;
  candidateAdBlocks: number;
  cueMarkerBlocks: number;
  scte35Blocks: number;
  daterangeBlocks: number;
  keywordBlocks: number;
  alternateHostBlocks: number;
  primaryHost: string | null;
  removedBlocks: M3U8RemovedAdBlockInfo[];
};

export type M3U8AdFilterDebugInfo = {
  shouldLog: boolean;
  removedLineCount: number;
  summary: M3U8AdDebugSummary;
};

type PlaylistBlock = {
  separatorBefore: string | null;
  lines: string[];
  mediaUrls: string[];
  mediaHosts: string[];
  segmentCount: number;
  durationSeconds: number;
  segmentDurations: number[];
  startTimeSeconds: number;
  endTimeSeconds: number;
  hasCueMarker: boolean;
  hasScte35: boolean;
  hasAdDaterange: boolean;
  hasKeywordMatch: boolean;
};

type PlaylistSegment = KnownHlsAdRuleSegment & {
  extinfLineIndex: number;
  urlLineIndex: number;
};

function isDiscontinuityLine(line: string): boolean {
  return line === DISCONTINUITY_TAG;
}

function isCueOutLine(line: string): boolean {
  return line.startsWith(CUE_OUT_TAG);
}

function isCueInLine(line: string): boolean {
  return line.startsWith(CUE_IN_TAG);
}

function isScte35Line(line: string): boolean {
  return line.startsWith(SCTE35_TAG);
}

function isAdDaterangeLine(line: string): boolean {
  if (!line.startsWith(DATERANGE_TAG)) {
    return false;
  }

  return (
    /(CLASS|ID)="[^"]*(ad|ads|advert|commercial)[^"]*"/i.test(line) ||
    /SCTE35-(OUT|IN)=/i.test(line) ||
    /X-AD-/i.test(line)
  );
}

function parseExtinfDuration(line: string): number {
  const match = line.match(/^#EXTINF:([\d.]+)/);
  if (!match) return 0;

  const duration = Number.parseFloat(match[1]);
  return Number.isFinite(duration) ? duration : 0;
}

function resolveMediaUrl(input: string, baseUrl?: string): string {
  if (!input) return input;

  try {
    return baseUrl
      ? new URL(input, baseUrl).toString()
      : new URL(input).toString();
  } catch {
    return input;
  }
}

function extractHost(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getPrimaryHost(
  blocks: PlaylistBlock[],
  baseUrl?: string
): string | null {
  const counts = new Map<string, number>();

  blocks.forEach((block) => {
    block.mediaHosts.forEach((host) => {
      counts.set(host, (counts.get(host) || 0) + 1);
    });
  });

  if (!counts.size && baseUrl) {
    return extractHost(baseUrl);
  }

  let primaryHost: string | null = null;
  let highestCount = 0;

  counts.forEach((count, host) => {
    if (count > highestCount) {
      highestCount = count;
      primaryHost = host;
    }
  });

  return primaryHost;
}

function findAdjacentDiscontinuityIndex(
  lines: string[],
  startIndex: number,
  direction: -1 | 1
): number | null {
  let currentIndex = startIndex;

  while (currentIndex >= 0 && currentIndex < lines.length) {
    const trimmedLine = lines[currentIndex].trim();
    if (!trimmedLine) {
      currentIndex += direction;
      continue;
    }

    return isDiscontinuityLine(trimmedLine) ? currentIndex : null;
  }

  return null;
}

function findNextDiscontinuityIndex(
  lines: string[],
  startIndex: number
): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (isDiscontinuityLine(lines[index].trim())) {
      return index;
    }
  }

  return null;
}

function removeCueMarkedRanges(lines: string[]): string[] {
  const removeLine = new Array(lines.length).fill(false);

  for (let index = 0; index < lines.length; index += 1) {
    if (!isCueOutLine(lines[index].trim())) {
      continue;
    }

    const cueInIndex = lines.findIndex(
      (line, candidateIndex) =>
        candidateIndex > index && isCueInLine(line.trim())
    );
    const endIndex =
      cueInIndex >= 0
        ? cueInIndex
        : findNextDiscontinuityIndex(lines, index + 1);

    if (endIndex == null) {
      continue;
    }

    const rangeStart =
      findAdjacentDiscontinuityIndex(lines, index - 1, -1) ?? index;
    const rangeEnd =
      findAdjacentDiscontinuityIndex(lines, endIndex + 1, 1) ?? endIndex;

    for (
      let removeIndex = rangeStart;
      removeIndex <= rangeEnd;
      removeIndex += 1
    ) {
      removeLine[removeIndex] = true;
    }

    index = rangeEnd;
  }

  return lines.filter((_line, index) => !removeLine[index]);
}

function buildBlock(
  lines: string[],
  separatorBefore: string | null,
  startTimeSeconds: number,
  baseUrl?: string
): PlaylistBlock {
  let segmentCount = 0;
  let durationSeconds = 0;
  const segmentDurations: number[] = [];

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#EXTINF:')) {
      const duration = parseExtinfDuration(trimmedLine);
      segmentCount += 1;
      durationSeconds += duration;
      segmentDurations.push(duration);
    }
  });

  const mediaUrls = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => resolveMediaUrl(line, baseUrl));

  const mediaHosts = Array.from(
    new Set(
      mediaUrls
        .map((url) => extractHost(url))
        .filter((host): host is string => Boolean(host))
    )
  );

  return {
    separatorBefore,
    lines,
    mediaUrls,
    mediaHosts,
    segmentCount,
    durationSeconds,
    segmentDurations,
    startTimeSeconds,
    endTimeSeconds: startTimeSeconds + durationSeconds,
    hasCueMarker: lines.some((line) => {
      const trimmedLine = line.trim();
      return isCueOutLine(trimmedLine) || isCueInLine(trimmedLine);
    }),
    hasScte35: lines.some((line) => isScte35Line(line.trim())),
    hasAdDaterange: lines.some((line) => isAdDaterangeLine(line.trim())),
    hasKeywordMatch: mediaUrls.some((url) =>
      AD_URL_PATTERNS.some((pattern) => pattern.test(url))
    ),
  };
}

function splitIntoBlocks(lines: string[], baseUrl?: string): PlaylistBlock[] {
  const blocks: PlaylistBlock[] = [];
  let currentLines: string[] = [];
  let separatorBefore: string | null = null;
  let currentStartTimeSeconds = 0;
  let elapsedTimeSeconds = 0;

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (isDiscontinuityLine(trimmedLine)) {
      blocks.push(
        buildBlock(
          currentLines,
          separatorBefore,
          currentStartTimeSeconds,
          baseUrl
        )
      );
      currentLines = [];
      separatorBefore = line;
      currentStartTimeSeconds = elapsedTimeSeconds;
      return;
    }

    currentLines.push(line);
    if (trimmedLine.startsWith('#EXTINF:')) {
      elapsedTimeSeconds += parseExtinfDuration(trimmedLine);
    }
  });

  blocks.push(
    buildBlock(currentLines, separatorBefore, currentStartTimeSeconds, baseUrl)
  );

  return blocks;
}

function getUrlPathname(input: string): string {
  try {
    return new URL(input).pathname;
  } catch {
    return '';
  }
}

function splitIntoSegments(
  lines: string[],
  baseUrl?: string
): PlaylistSegment[] {
  const segments: PlaylistSegment[] = [];
  let elapsedTimeSeconds = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmedLine = lines[index].trim();
    if (!trimmedLine.startsWith('#EXTINF:')) {
      continue;
    }

    const durationSeconds = parseExtinfDuration(trimmedLine);
    const nextLine = lines[index + 1]?.trim() || '';
    const mediaUrl = resolveMediaUrl(nextLine, baseUrl);

    segments.push({
      segmentIndex: segments.length,
      extinfLineIndex: index,
      urlLineIndex: index + 1,
      durationSeconds,
      startTimeSeconds: elapsedTimeSeconds,
      endTimeSeconds: elapsedTimeSeconds + durationSeconds,
      mediaHost: extractHost(mediaUrl),
      mediaUrl,
      pathname: getUrlPathname(mediaUrl),
    });

    elapsedTimeSeconds += durationSeconds;
  }

  return segments;
}

function getKnownSegmentRuleMatches(
  lines: string[],
  baseUrl?: string
): KnownHlsAdSegmentRuleMatch[] {
  const segments = splitIntoSegments(lines, baseUrl);
  const knownMatches = findKnownHlsAdSegmentRuleMatches(segments, {
    baseUrl,
  });
  const knownSegmentIndexes = new Set(
    knownMatches.flatMap((match) => match.segmentIndexes)
  );
  const automaticMatches = findAutomaticForeignPathSegmentMatches(
    segments,
    baseUrl
  ).filter((match) =>
    match.segmentIndexes.every((index) => !knownSegmentIndexes.has(index))
  );

  return [...knownMatches, ...automaticMatches];
}

function isDatedMediaPathOutsideBase(
  pathname: string,
  baseDirectory: string
): boolean {
  return (
    !pathname.startsWith(baseDirectory) &&
    /^\/\d{8}\/[^/]+\/(?:\d+kb|[^/]+)\/hls\/[^/]+\.(?:ts|m4s|mp4)$/i.test(
      pathname
    )
  );
}

function findAutomaticForeignPathSegmentMatches(
  segments: PlaylistSegment[],
  baseUrl?: string
): KnownHlsAdSegmentRuleMatch[] {
  const baseHost = extractHost(baseUrl || '');
  const baseDirectory = (() => {
    if (!baseUrl) return null;
    try {
      const path = new URL(baseUrl).pathname;
      return path.slice(0, path.lastIndexOf('/') + 1);
    } catch {
      return null;
    }
  })();

  if (!baseHost || !baseDirectory) {
    return [];
  }

  const foreignSegments = segments.filter((segment) => {
    if (segment.mediaHost !== baseHost) {
      return false;
    }

    if (!isDatedMediaPathOutsideBase(segment.pathname, baseDirectory)) {
      return false;
    }

    return segment.durationSeconds > 0 && segment.durationSeconds <= 4.5;
  });

  return groupConsecutivePlaylistSegments(foreignSegments)
    .filter((group) => {
      const durationSeconds = group.reduce(
        (sum, segment) => sum + segment.durationSeconds,
        0
      );

      return (
        group.length >= 6 &&
        group.length <= 14 &&
        durationSeconds >= 8 &&
        durationSeconds <= 35
      );
    })
    .map((group) => ({
      ruleId: 'auto-foreign-path-short-run-v1',
      ruleName: '自动识别同域异目录连续短分片',
      segmentIndexes: group.map((segment) => segment.segmentIndex),
      segmentCount: group.length,
      durationSeconds: Number(
        group
          .reduce((sum, segment) => sum + segment.durationSeconds, 0)
          .toFixed(3)
      ),
      startTimeSeconds: Number(group[0].startTimeSeconds.toFixed(3)),
      endTimeSeconds: Number(
        group[group.length - 1].endTimeSeconds.toFixed(3)
      ),
      mediaHosts: Array.from(
        new Set(
          group
            .map((segment) => segment.mediaHost)
            .filter((host): host is string => Boolean(host))
        )
      ),
      sampleUrls: group.map((segment) => segment.mediaUrl).slice(0, 3),
    }));
}

function groupConsecutivePlaylistSegments(
  segments: PlaylistSegment[]
): PlaylistSegment[][] {
  const groups: PlaylistSegment[][] = [];
  let currentGroup: PlaylistSegment[] = [];

  segments.forEach((segment) => {
    const previousSegment = currentGroup[currentGroup.length - 1];
    if (
      previousSegment &&
      segment.segmentIndex === previousSegment.segmentIndex + 1
    ) {
      currentGroup.push(segment);
      return;
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    currentGroup = [segment];
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function createRemovedSegmentRunInfo(
  match: KnownHlsAdSegmentRuleMatch
): M3U8RemovedAdBlockInfo {
  return {
    reason: 'known-rule',
    reasons: ['known-rule'],
    segmentCount: match.segmentCount,
    durationSeconds: match.durationSeconds,
    startTimeSeconds: match.startTimeSeconds,
    endTimeSeconds: match.endTimeSeconds,
    hosts: match.mediaHosts,
    sampleUrls: match.sampleUrls,
    ruleId: match.ruleId,
    ruleName: match.ruleName,
  };
}

function removeKnownAdSegmentRuns(lines: string[], baseUrl?: string): string[] {
  const segmentRuleMatches = getKnownSegmentRuleMatches(lines, baseUrl);
  if (segmentRuleMatches.length === 0) {
    return lines;
  }

  const segments = splitIntoSegments(lines, baseUrl);
  const segmentIndexesToRemove = new Set(
    segmentRuleMatches.flatMap((match) => match.segmentIndexes)
  );
  const lineIndexesToRemove = new Set<number>();

  segments.forEach((segment) => {
    if (!segmentIndexesToRemove.has(segment.segmentIndex)) {
      return;
    }

    lineIndexesToRemove.add(segment.extinfLineIndex);
    lineIndexesToRemove.add(segment.urlLineIndex);
  });

  return lines.filter((_line, index) => !lineIndexesToRemove.has(index));
}

function hasNeighborUsingPrimaryHost(
  blocks: PlaylistBlock[],
  blockIndex: number,
  primaryHost: string
): boolean {
  return [blocks[blockIndex - 1], blocks[blockIndex + 1]].some((block) =>
    block?.mediaHosts.includes(primaryHost)
  );
}

function isAlternateHostAdBlock(
  block: PlaylistBlock,
  blockIndex: number,
  blocks: PlaylistBlock[],
  primaryHost: string | null
): boolean {
  if (!primaryHost || !block.mediaHosts.length) {
    return false;
  }

  const allHostsDifferFromPrimary = block.mediaHosts.every(
    (host) => host !== primaryHost
  );

  if (!allHostsDifferFromPrimary) {
    return false;
  }

  return hasNeighborUsingPrimaryHost(blocks, blockIndex, primaryHost);
}

function getAdBlockReasons(
  block: PlaylistBlock,
  blockIndex: number,
  blocks: PlaylistBlock[],
  primaryHost: string | null,
  knownRuleMatch: KnownHlsAdRuleMatch | null
): AdBlockReason[] {
  const reasons: AdBlockReason[] = [];

  if (block.hasCueMarker) {
    reasons.push('cue-marker');
  }

  if (block.hasScte35) {
    reasons.push('scte35');
  }

  if (block.hasAdDaterange) {
    reasons.push('daterange');
  }

  if (block.hasKeywordMatch) {
    reasons.push('url-keyword');
  }

  if (isAlternateHostAdBlock(block, blockIndex, blocks, primaryHost)) {
    reasons.push('alternate-host');
  }

  if (knownRuleMatch) {
    reasons.push('known-rule');
  }

  return reasons;
}

function isAdBlock(
  block: PlaylistBlock,
  blockIndex: number,
  blocks: PlaylistBlock[],
  primaryHost: string | null,
  knownRuleMatch: KnownHlsAdRuleMatch | null
): boolean {
  return getAdBlockReasons(
    block,
    blockIndex,
    blocks,
    primaryHost,
    knownRuleMatch
  ).some((reason) => reason !== 'url-keyword');
}

function filterDiscontinuityBlocks(
  lines: string[],
  baseUrl?: string
): string[] {
  if (!lines.some((line) => isDiscontinuityLine(line.trim()))) {
    return lines;
  }

  const blocks = splitIntoBlocks(lines, baseUrl);
  const primaryHost = getPrimaryHost(blocks, baseUrl);
  const filteredLines: string[] = [];
  const knownRuleMatches = getKnownRuleMatches(blocks, baseUrl);
  const shouldRemoveBlock = blocks.map((block, blockIndex) =>
    isAdBlock(
      block,
      blockIndex,
      blocks,
      primaryHost,
      knownRuleMatches[blockIndex]
    )
  );

  blocks.forEach((block, blockIndex) => {
    if (
      blockIndex > 0 &&
      !shouldRemoveBlock[blockIndex - 1] &&
      !shouldRemoveBlock[blockIndex] &&
      block.separatorBefore
    ) {
      filteredLines.push(block.separatorBefore);
    }

    if (!shouldRemoveBlock[blockIndex]) {
      filteredLines.push(...block.lines);
    }
  });

  return filteredLines;
}

function countLinesByPrefix(lines: string[], prefix: string): number {
  return lines.filter((line) => line.trim().startsWith(prefix)).length;
}

function createRemovedBlockInfo(
  block: PlaylistBlock,
  reasons: AdBlockReason[],
  knownRuleMatch: KnownHlsAdRuleMatch | null = null
): M3U8RemovedAdBlockInfo {
  return {
    reason: reasons[0],
    reasons,
    segmentCount: block.segmentCount,
    durationSeconds: Number(block.durationSeconds.toFixed(3)),
    startTimeSeconds: Number(block.startTimeSeconds.toFixed(3)),
    endTimeSeconds: Number(block.endTimeSeconds.toFixed(3)),
    hosts: block.mediaHosts,
    sampleUrls: block.mediaUrls.slice(0, 3),
    ruleId: knownRuleMatch?.ruleId,
    ruleName: knownRuleMatch?.ruleName,
  };
}

function getKnownRuleMatches(
  blocks: PlaylistBlock[],
  baseUrl?: string
): Array<KnownHlsAdRuleMatch | null> {
  const ruleBlocks = blocks.map((block, blockIndex) => ({
    blockIndex,
    segmentCount: block.segmentCount,
    durationSeconds: block.durationSeconds,
    startTimeSeconds: block.startTimeSeconds,
    endTimeSeconds: block.endTimeSeconds,
    mediaHosts: block.mediaHosts,
    mediaUrls: block.mediaUrls,
    segmentDurations: block.segmentDurations,
  }));

  return ruleBlocks.map((block) =>
    findKnownHlsAdRuleMatch(block, {
      baseUrl,
      blocks: ruleBlocks,
    })
  );
}

function shouldLogAdFilterDebug(
  summary: M3U8AdDebugSummary,
  removedLineCount: number
): boolean {
  return (
    removedLineCount > 0 ||
    summary.candidateAdBlocks > 0 ||
    summary.cueOutCount > 0 ||
    summary.cueInCount > 0 ||
    summary.scte35Count > 0 ||
    summary.daterangeCount > 0
  );
}

export function getM3U8AdDebugSummary(
  content: string,
  baseUrl?: string,
  filteredLineCount?: number
): M3U8AdDebugSummary {
  const lines = content ? content.split(/\r?\n/) : [];
  const blocks = splitIntoBlocks(lines, baseUrl);
  const primaryHost = getPrimaryHost(blocks, baseUrl);
  const knownRuleMatches = getKnownRuleMatches(blocks, baseUrl);
  const blockReasons = blocks.map((block, blockIndex) =>
    getAdBlockReasons(
      block,
      blockIndex,
      blocks,
      primaryHost,
      knownRuleMatches[blockIndex]
    )
  );
  const blockRemovedInfos = blocks
    .map((block, blockIndex) => ({
      block,
      blockIndex,
      reasons: blockReasons[blockIndex],
    }))
    .filter(
      ({ block, reasons }) =>
        block.segmentCount > 0 &&
        reasons.some((reason) => reason !== 'url-keyword')
    )
    .map(({ block, blockIndex, reasons }) =>
      createRemovedBlockInfo(block, reasons, knownRuleMatches[blockIndex])
    );
  const segmentRemovedInfos = getKnownSegmentRuleMatches(lines, baseUrl).map(
    createRemovedSegmentRunInfo
  );
  return {
    totalLines: lines.length,
    filteredLineCount: filteredLineCount ?? lines.length,
    extinfCount: countLinesByPrefix(lines, '#EXTINF'),
    discontinuityCount: lines.filter((line) => isDiscontinuityLine(line.trim()))
      .length,
    cueOutCount: lines.filter((line) => isCueOutLine(line.trim())).length,
    cueInCount: lines.filter((line) => isCueInLine(line.trim())).length,
    scte35Count: lines.filter((line) => isScte35Line(line.trim())).length,
    daterangeCount: lines.filter((line) =>
      line.trim().startsWith(DATERANGE_TAG)
    ).length,
    candidateAdBlocks: blockReasons.filter((reasons) => reasons.length > 0)
      .length,
    cueMarkerBlocks: blockReasons.filter((reasons) =>
      reasons.includes('cue-marker')
    ).length,
    scte35Blocks: blockReasons.filter((reasons) => reasons.includes('scte35'))
      .length,
    daterangeBlocks: blockReasons.filter((reasons) =>
      reasons.includes('daterange')
    ).length,
    keywordBlocks: blockReasons.filter((reasons) =>
      reasons.includes('url-keyword')
    ).length,
    alternateHostBlocks: blockReasons.filter((reasons) =>
      reasons.includes('alternate-host')
    ).length,
    primaryHost,
    removedBlocks: [...blockRemovedInfos, ...segmentRemovedInfos],
  };
}

export function getM3U8AdFilterDebugInfo(
  originalContent: string,
  filteredContent: string,
  baseUrl?: string
): M3U8AdFilterDebugInfo {
  const filteredLineCount = filteredContent
    ? filteredContent.split(/\r?\n/).length
    : 0;
  const summary = getM3U8AdDebugSummary(
    originalContent,
    baseUrl,
    filteredLineCount
  );
  const removedLineCount = Math.max(summary.totalLines - filteredLineCount, 0);

  return {
    shouldLog: shouldLogAdFilterDebug(summary, removedLineCount),
    removedLineCount,
    summary,
  };
}

export function observeM3U8AdSignals(
  content: string,
  baseUrl?: string
): M3U8AdFilterDebugInfo {
  const simulatedFilteredContent = filterAdsFromM3U8(content, baseUrl);
  return getM3U8AdFilterDebugInfo(
    content,
    simulatedFilteredContent,
    baseUrl
  );
}

function formatDurationClock(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}`;
}

function formatBlockReason(reason: AdBlockReason): string {
  switch (reason) {
    case 'cue-marker':
      return '广告标记';
    case 'scte35':
      return 'SCTE-35 标记';
    case 'daterange':
      return '广告时间段标记';
    case 'url-keyword':
      return '地址关键词';
    case 'alternate-host':
      return '异常域名';
    case 'known-rule':
      return '规则库命中';
    case 'foreign-path':
      return '异目录短分片';
    case 'short-discontinuity':
      return '短不连续片段';
    default:
      return reason;
  }
}

export function formatM3U8AdFilterDebugMessage(
  debugInfo: M3U8AdFilterDebugInfo
): string {
  if (!debugInfo.summary.removedBlocks.length) {
    return '检测到广告相关信号，但本次未移除分段';
  }

  const details = debugInfo.summary.removedBlocks
    .map((block, index) => {
      const timeRange = `${formatDurationClock(
        block.startTimeSeconds
      )}-${formatDurationClock(block.endTimeSeconds)}`;
      const reasons = block.reasons.map(formatBlockReason).join('、');
      const ruleLabel = block.ruleId ? `，规则：${block.ruleId}` : '';

      return `第 ${
        index + 1
      } 段 ${timeRange}，约 ${block.durationSeconds.toFixed(1)} 秒，${
        block.segmentCount
      } 个片段，原因：${reasons}${ruleLabel}`;
    })
    .join('；');

  return `发现 ${debugInfo.summary.removedBlocks.length} 段疑似广告内容：${details}`;
}

function getCandidateAction(
  reasons: AdBlockReason[],
  confidence: M3U8AdCandidateConfidence
): M3U8AdCandidateAction {
  if (confidence !== 'high') {
    return 'observe';
  }

  if (reasons.length === 1 && reasons[0] === 'short-discontinuity') {
    return 'observe';
  }

  return 'filter';
}

function getBlockCandidateConfidence(
  reasons: AdBlockReason[]
): M3U8AdCandidateConfidence {
  if (
    reasons.some((reason) =>
      [
        'cue-marker',
        'scte35',
        'daterange',
        'alternate-host',
        'known-rule',
        'foreign-path',
      ].includes(reason)
    )
  ) {
    return 'high';
  }

  if (reasons.includes('url-keyword')) {
    return 'medium';
  }

  return 'low';
}

function createCandidateFromRemovedBlock(
  block: M3U8RemovedAdBlockInfo
): M3U8AdCandidate {
  const reasons: AdBlockReason[] = block.ruleId?.startsWith(
    'auto-foreign-path'
  )
    ? Array.from(new Set<AdBlockReason>([...block.reasons, 'foreign-path']))
    : block.reasons;
  const confidence = getBlockCandidateConfidence(reasons);

  return {
    startTimeSeconds: block.startTimeSeconds,
    endTimeSeconds: block.endTimeSeconds,
    durationSeconds: block.durationSeconds,
    segmentIndexes: [],
    segmentCount: block.segmentCount,
    reasons,
    confidence,
    action: getCandidateAction(reasons, confidence),
    ruleId: block.ruleId,
    ruleName: block.ruleName,
    hosts: block.hosts,
    sampleUrls: block.sampleUrls,
  };
}

function createLowConfidenceShortBlockCandidates(
  content: string,
  baseUrl?: string
): M3U8AdCandidate[] {
  const lines = content ? content.split(/\r?\n/) : [];
  const blocks = splitIntoBlocks(lines, baseUrl);
  const primaryHost = getPrimaryHost(blocks, baseUrl);
  const knownRuleMatches = getKnownRuleMatches(blocks, baseUrl);

  const candidates = blocks
    .map((block, blockIndex) => {
      const reasons = getAdBlockReasons(
        block,
        blockIndex,
        blocks,
        primaryHost,
        knownRuleMatches[blockIndex]
      );

      if (
        reasons.length > 0 ||
        !block.separatorBefore ||
        block.segmentCount <= 0 ||
        block.segmentCount > 3 ||
        block.durationSeconds > 20
      ) {
        return null;
      }

      const candidate: M3U8AdCandidate = {
        startTimeSeconds: Number(block.startTimeSeconds.toFixed(3)),
        endTimeSeconds: Number(block.endTimeSeconds.toFixed(3)),
        durationSeconds: Number(block.durationSeconds.toFixed(3)),
        segmentIndexes: [] as number[],
        segmentCount: block.segmentCount,
        reasons: ['short-discontinuity' as AdBlockReason],
        confidence: 'low' as M3U8AdCandidateConfidence,
        action: 'observe' as M3U8AdCandidateAction,
        hosts: block.mediaHosts,
        sampleUrls: block.mediaUrls.slice(0, 3),
      };

      return candidate;
    })
    .filter((candidate): candidate is M3U8AdCandidate => Boolean(candidate));

  return candidates;
}

export function analyzeM3U8AdCandidates(
  content: string,
  baseUrl?: string
): M3U8AdAnalysis {
  const filteredContent = filterAdsFromM3U8(content, baseUrl);
  const debugInfo = getM3U8AdFilterDebugInfo(content, filteredContent, baseUrl);
  const candidates = [
    ...debugInfo.summary.removedBlocks.map(createCandidateFromRemovedBlock),
    ...createLowConfidenceShortBlockCandidates(content, baseUrl),
  ];

  return {
    candidates,
    summary: debugInfo.summary,
    filteredContent,
    removedLineCount: debugInfo.removedLineCount,
  };
}

export function applyM3U8AdFiltering(
  content: string,
  analysis: M3U8AdAnalysis,
  policy: M3U8AdFilteringPolicy = {}
): string {
  const minimumConfidence = policy.minimumConfidence || 'high';
  const shouldFilter = analysis.candidates.some(
    (candidate) =>
      candidate.action === 'filter' &&
      (minimumConfidence !== 'high' || candidate.confidence === 'high')
  );

  return shouldFilter ? analysis.filteredContent : content;
}

export function filterAdsFromM3U8(content: string, baseUrl?: string): string {
  if (!content) {
    return '';
  }

  const hasSegmentEntries = content.includes('#EXTINF');
  const hasAdSignals =
    content.includes(CUE_OUT_TAG) ||
    content.includes(CUE_IN_TAG) ||
    content.includes(SCTE35_TAG) ||
    content.includes(DATERANGE_TAG);

  if (!hasSegmentEntries && !hasAdSignals) {
    return content;
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const normalizedLines = content.split(/\r?\n/);
  const cueFilteredLines = removeCueMarkedRanges(normalizedLines);
  const segmentFilteredLines = removeKnownAdSegmentRuns(
    cueFilteredLines,
    baseUrl
  );
  const fullyFilteredLines = filterDiscontinuityBlocks(
    segmentFilteredLines,
    baseUrl
  );

  return fullyFilteredLines.join(newline);
}
