export interface SourceRankingRuntime {
  enabled: boolean;
  hasD1: boolean;
  fallbackToLive: boolean;
}

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

function hasValue(source: RuntimeSource, key: string) {
  const value = source[key];
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

export function getSourceRankingRuntime(
  env?: RuntimeSource
): SourceRankingRuntime {
  const source =
    env || (process.env as unknown as Record<string, string | undefined>);

  return {
    enabled: readFlag(source, 'SOURCE_RANKING_ENABLED'),
    hasD1: hasValue(source, 'DB') || readFlag(source, 'SOURCE_RANKING_HAS_D1'),
    fallbackToLive: readFlag(source, 'SOURCE_RANKING_FALLBACK_TO_LIVE', true),
  };
}
