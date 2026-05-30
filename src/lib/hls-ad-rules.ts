export type KnownHlsAdRuleBlock = {
  blockIndex: number;
  segmentCount: number;
  durationSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  mediaHosts: string[];
  mediaUrls: string[];
  segmentDurations: number[];
};

export type KnownHlsAdRuleContext = {
  baseUrl?: string;
  blocks: KnownHlsAdRuleBlock[];
};

export type KnownHlsAdRuleSegment = {
  segmentIndex: number;
  durationSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  mediaHost: string | null;
  mediaUrl: string;
  pathname: string;
};

export type KnownHlsAdRuleMatch = {
  ruleId: string;
  ruleName: string;
};

export type KnownHlsAdSegmentRuleMatch = KnownHlsAdRuleMatch & {
  segmentIndexes: number[];
  segmentCount: number;
  durationSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  mediaHosts: string[];
  sampleUrls: string[];
};

export type KnownHlsAdRule = {
  id: string;
  name: string;
  description: string;
  matches: (
    block: KnownHlsAdRuleBlock,
    context: KnownHlsAdRuleContext
  ) => boolean;
};

type KnownHlsAdSegmentRule = {
  id: string;
  name: string;
  description: string;
  findMatches: (
    segments: KnownHlsAdRuleSegment[],
    context: { baseUrl?: string }
  ) => KnownHlsAdSegmentRuleMatch[];
};

function getHost(input?: string): string | null {
  if (!input) return null;

  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isRyplayHost(host: string | null): boolean {
  return Boolean(host && /(^|\.)ryplay\d*\.com$/i.test(host));
}

function isModujx10Host(host: string | null): boolean {
  return Boolean(host && /(^|\.)modujx\d+\.com$/i.test(host));
}

function hasRyplayContext(
  block: KnownHlsAdRuleBlock,
  context: KnownHlsAdRuleContext
): boolean {
  const baseHost = getHost(context.baseUrl);
  return isRyplayHost(baseHost) || block.mediaHosts.some(isRyplayHost);
}

function isStableSixSegmentContentBlock(
  block: KnownHlsAdRuleBlock | undefined
): boolean {
  if (!block) return false;

  return (
    block.segmentCount === 6 &&
    block.durationSeconds >= 55 &&
    block.durationSeconds <= 70 &&
    block.segmentDurations.every((duration) => duration >= 8 && duration <= 12)
  );
}

function isShortVariableSixSegmentBlock(block: KnownHlsAdRuleBlock): boolean {
  if (block.segmentCount !== 6) {
    return false;
  }

  if (block.durationSeconds < 18 || block.durationSeconds > 28) {
    return false;
  }

  const maxDuration = Math.max(...block.segmentDurations);
  const minDuration = Math.min(...block.segmentDurations);

  return maxDuration <= 6 && minDuration <= 2;
}

function durationCloseTo(
  actualDuration: number,
  expectedDuration: number
): boolean {
  return Math.abs(actualDuration - expectedDuration) <= 0.05;
}

function hasRyplayCasinoDurationFingerprint(
  block: KnownHlsAdRuleBlock
): boolean {
  const casinoAdDurations = [4, 5.48, 4, 3.24, 4, 1.28];

  return (
    block.segmentCount === casinoAdDurations.length &&
    block.durationSeconds >= 21.8 &&
    block.durationSeconds <= 22.2 &&
    casinoAdDurations.every((duration, index) =>
      durationCloseTo(block.segmentDurations[index], duration)
    )
  );
}

function getBasePlaylistDirectory(baseUrl?: string): string | null {
  if (!baseUrl) return null;

  try {
    const path = new URL(baseUrl).pathname;
    return path.slice(0, path.lastIndexOf('/') + 1);
  } catch {
    return null;
  }
}

function groupConsecutiveSegments(
  segments: KnownHlsAdRuleSegment[]
): KnownHlsAdRuleSegment[][] {
  const groups: KnownHlsAdRuleSegment[][] = [];
  let currentGroup: KnownHlsAdRuleSegment[] = [];

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

function createSegmentRuleMatch(
  rule: Pick<KnownHlsAdSegmentRule, 'id' | 'name'>,
  segments: KnownHlsAdRuleSegment[]
): KnownHlsAdSegmentRuleMatch {
  const hosts = Array.from(
    new Set(
      segments
        .map((segment) => segment.mediaHost)
        .filter((host): host is string => Boolean(host))
    )
  );

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    segmentIndexes: segments.map((segment) => segment.segmentIndex),
    segmentCount: segments.length,
    durationSeconds: Number(
      segments
        .reduce((sum, segment) => sum + segment.durationSeconds, 0)
        .toFixed(3)
    ),
    startTimeSeconds: Number(segments[0].startTimeSeconds.toFixed(3)),
    endTimeSeconds: Number(
      segments[segments.length - 1].endTimeSeconds.toFixed(3)
    ),
    mediaHosts: hosts,
    sampleUrls: segments.map((segment) => segment.mediaUrl).slice(0, 3),
  };
}

function getPathBasename(pathname: string): string {
  const index = pathname.lastIndexOf('/');
  return index >= 0 ? pathname.slice(index + 1) : pathname;
}

function findConsecutiveSegmentNames(
  segments: KnownHlsAdRuleSegment[],
  expectedNames: string[]
): KnownHlsAdRuleSegment[] {
  if (expectedNames.length === 0) {
    return [];
  }

  for (
    let index = 0;
    index <= segments.length - expectedNames.length;
    index += 1
  ) {
    const candidate = segments.slice(index, index + expectedNames.length);
    const isMatch = candidate.every(
      (segment, candidateIndex) =>
        getPathBasename(segment.pathname) === expectedNames[candidateIndex]
    );

    if (isMatch) {
      return candidate;
    }
  }

  return [];
}

export const KNOWN_HLS_AD_RULES: KnownHlsAdRule[] = [
  {
    id: 'ruyi-ryplay-22s-midroll-v1',
    name: '如意 ryplay 22 秒中插广告',
    description:
      '如意资源 ryplay 播放列表会把正片切成约 62.5 秒的稳定 6 片段组，中间夹一个约 22 秒、6 个短片段的广告组。',
    matches(block, context) {
      if (!hasRyplayContext(block, context)) {
        return false;
      }

      if (
        block.blockIndex === 0 ||
        block.blockIndex === context.blocks.length - 1
      ) {
        return false;
      }

      if (!isShortVariableSixSegmentBlock(block)) {
        return false;
      }

      return (
        isStableSixSegmentContentBlock(context.blocks[block.blockIndex - 1]) &&
        isStableSixSegmentContentBlock(context.blocks[block.blockIndex + 1])
      );
    },
  },
  {
    id: 'ruyi-ryplay-casino-22s-midroll-v1',
    name: '如意 ryplay 22 秒博彩中插广告',
    description:
      '如意资源 ryplay 新剧集会把正片也切成 20 多秒短组，博彩贴片可通过 4/5.48/4/3.24/4/1.28 秒的 6 片段时长指纹识别。',
    matches(block, context) {
      if (!hasRyplayContext(block, context)) {
        return false;
      }

      if (
        block.blockIndex === 0 ||
        block.blockIndex === context.blocks.length - 1
      ) {
        return false;
      }

      return hasRyplayCasinoDurationFingerprint(block);
    },
  },
];

const KNOWN_HLS_AD_SEGMENT_RULES: KnownHlsAdSegmentRule[] = [
  {
    id: 'ruyi-ryplay12-jjk-s3-ep1-20260109-v1',
    name: '如意 ryplay12 咒术回战第三季第 1 集中插广告',
    description:
      '用户在 iPad Chrome 预览环境反馈 6:56 到 7:10、8:04、9:22 到 9:40 左右出现广告；该样本同源正常内容也大量使用短分片，因此只按当前剧集目录和连续分片文件名精确命中。',
    findMatches(segments, context) {
      const baseHost = getHost(context.baseUrl);
      const baseDirectory = getBasePlaylistDirectory(context.baseUrl);
      if (
        !isRyplayHost(baseHost) ||
        baseDirectory !== '/20260109/30954_0fe9a7a0/2000k/hls/'
      ) {
        return [];
      }

      const segmentFingerprints = [
        [
          '10a32e39c0614f2366557b3eda961771.ts',
          '67deb25d2552d1d315fef8ecfb8937b3.ts',
          '3953b607206dfff90b77b43042936d28.ts',
          '9cbefbed5c7cb46d39489166e4919c0d.ts',
        ],
        [
          'bef3f550e01ce9acff81a337d38689be.ts',
          'ab4d121a23ab5e7435b9dd668e608623.ts',
          '40e8cb440c21f6354564e7fe8eba9fa2.ts',
          '6565740a9e9e3963eaa6605077a40675.ts',
        ],
        [
          'abf506f673c6544122d5185d3267dceb.ts',
          'eee13f7ce5bd1f66a55af2a19f758533.ts',
          'be90370a3174e6296713ae7b0861a585.ts',
          '240d5e0714be9babea8412c0df2ffde9.ts',
        ],
      ];

      return segmentFingerprints.flatMap((fingerprint) => {
        const matchedSegments = findConsecutiveSegmentNames(
          segments,
          fingerprint
        );

        return matchedSegments.length === 0
          ? []
          : [
              createSegmentRuleMatch(
                {
                  id: 'ruyi-ryplay12-jjk-s3-ep1-20260109-v1',
                  name: '如意 ryplay12 咒术回战第三季第 1 集中插广告',
                },
                matchedSegments
              ),
            ];
      });
    },
  },
  {
    id: 'moduapi-modujx10-foreign-path-v1',
    name: 'moduapi modujx10 外目录插入广告',
    description:
      'modujx10 播放列表的正片分片通常位于当前剧集目录，广告会以同域名但不同日期、不同码率目录的连续短分片插入。',
    findMatches(segments, context) {
      const baseHost = getHost(context.baseUrl);
      const baseDirectory = getBasePlaylistDirectory(context.baseUrl);
      if (!isModujx10Host(baseHost) || !baseDirectory) {
        return [];
      }

      const foreignSegments = segments.filter((segment) => {
        if (segment.mediaHost !== baseHost) {
          return false;
        }

        if (segment.pathname.startsWith(baseDirectory)) {
          return false;
        }

        return (
          /^\/\d{8}\/[^/]+\/\d+kb\/hls\/[^/]+\.ts$/i.test(segment.pathname) &&
          segment.durationSeconds <= 4
        );
      });

      return groupConsecutiveSegments(foreignSegments)
        .filter((group) => {
          const durationSeconds = group.reduce(
            (sum, segment) => sum + segment.durationSeconds,
            0
          );

          return (
            group.length >= 6 &&
            group.length <= 12 &&
            durationSeconds >= 8 &&
            durationSeconds <= 30
          );
        })
        .map((group) =>
          createSegmentRuleMatch(
            {
              id: 'moduapi-modujx10-foreign-path-v1',
              name: 'moduapi modujx10 外目录插入广告',
            },
            group
          )
        );
    },
  },
];

export function findKnownHlsAdRuleMatch(
  block: KnownHlsAdRuleBlock,
  context: KnownHlsAdRuleContext
): KnownHlsAdRuleMatch | null {
  const matchedRule = KNOWN_HLS_AD_RULES.find((rule) =>
    rule.matches(block, context)
  );

  if (!matchedRule) {
    return null;
  }

  return {
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
  };
}

export function findKnownHlsAdSegmentRuleMatches(
  segments: KnownHlsAdRuleSegment[],
  context: { baseUrl?: string }
): KnownHlsAdSegmentRuleMatch[] {
  return KNOWN_HLS_AD_SEGMENT_RULES.flatMap((rule) =>
    rule.findMatches(segments, context)
  );
}
