/**
 * 设置面板里可复用的布尔偏好定义。
 * 统一描述存储键、默认值与文案，避免每个入口各写一份 localStorage 读取逻辑。
 */
export interface BooleanPreferenceDefinition {
  id: string;
  label: string;
  description: string;
  storageKey: string;
  defaultValue: boolean;
}

export const playbackPreferences: readonly BooleanPreferenceDefinition[] = [
  {
    id: 'aggregateSearch',
    label: '搜索默认聚合多来源',
    description: '把同一部影片的不同线路合并展示；下次搜索生效',
    storageKey: 'defaultAggregateSearch',
    defaultValue: true,
  },
  {
    id: 'sourceOptimization',
    label: '优选最佳播放来源',
    description: '播放前测速并按线路质量排序；下次进入播放页生效',
    storageKey: 'enableOptimization',
    defaultValue: true,
  },
] as const;

export function readBooleanPreference(
  definition: BooleanPreferenceDefinition
): boolean {
  if (typeof window === 'undefined') return definition.defaultValue;
  try {
    const raw = window.localStorage.getItem(definition.storageKey);
    if (raw === null) return definition.defaultValue;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : definition.defaultValue;
  } catch {
    return definition.defaultValue;
  }
}

export function writeBooleanPreference(
  definition: BooleanPreferenceDefinition,
  value: boolean
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(definition.storageKey, JSON.stringify(value));
  } catch {
    /* 存储被禁用时保持静默，沿用默认值 */
  }
}
