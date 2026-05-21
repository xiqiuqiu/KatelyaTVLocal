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

export type KnownHlsAdRuleMatch = {
  ruleId: string;
  ruleName: string;
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
