export const SOURCE_RANKING_EXPERIMENT_POLICIES = {
  control: 'startup-budget-v1:cron-rank-off',
  ranking: 'startup-budget-v1:cron-rank-on',
} as const;

export type SourceRankingExperimentPolicy =
  (typeof SOURCE_RANKING_EXPERIMENT_POLICIES)[keyof typeof SOURCE_RANKING_EXPERIMENT_POLICIES];

export function sourceRankingExperimentPolicy(
  username: string
): SourceRankingExperimentPolicy {
  let hash = 2166136261;
  const key = `cron-rank-v1:${username}`;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash ^ (hash >>> 16)) & 1
    ? SOURCE_RANKING_EXPERIMENT_POLICIES.ranking
    : SOURCE_RANKING_EXPERIMENT_POLICIES.control;
}
