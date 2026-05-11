const DISCONTINUITY_TAG = '#EXT-X-DISCONTINUITY';
const CUE_OUT_TAG = '#EXT-X-CUE-OUT';
const CUE_IN_TAG = '#EXT-X-CUE-IN';
const SCTE35_TAG = '#EXT-X-SCTE35';
const DATERANGE_TAG = '#EXT-X-DATERANGE';

const AD_URL_PATTERNS = [
  /\/ads?(?:[/_-]|$)/i,
  /advertisement/i,
  /commercial/i,
];

type AdBlockReason =
  | 'cue-marker'
  | 'scte35'
  | 'daterange'
  | 'url-keyword'
  | 'alternate-host';

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
  hasCueMarker: boolean;
  hasScte35: boolean;
  hasAdDaterange: boolean;
  hasKeywordMatch: boolean;
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
  baseUrl?: string
): PlaylistBlock {
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

  lines.forEach((line) => {
    if (isDiscontinuityLine(line.trim())) {
      blocks.push(buildBlock(currentLines, separatorBefore, baseUrl));
      currentLines = [];
      separatorBefore = line;
      return;
    }

    currentLines.push(line);
  });

  blocks.push(buildBlock(currentLines, separatorBefore, baseUrl));

  return blocks;
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
  primaryHost: string | null
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

  return reasons;
}

function isAdBlock(
  block: PlaylistBlock,
  blockIndex: number,
  blocks: PlaylistBlock[],
  primaryHost: string | null
): boolean {
  return getAdBlockReasons(block, blockIndex, blocks, primaryHost).length > 0;
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
  const shouldRemoveBlock = blocks.map((block, blockIndex) =>
    isAdBlock(block, blockIndex, blocks, primaryHost)
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
  const blockReasons = blocks.map((block, blockIndex) =>
    getAdBlockReasons(block, blockIndex, blocks, primaryHost)
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
  const fullyFilteredLines = filterDiscontinuityBlocks(
    cueFilteredLines,
    baseUrl
  );

  return fullyFilteredLines.join(newline);
}
