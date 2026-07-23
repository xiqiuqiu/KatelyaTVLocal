import { AdminConfig } from './admin.types';
import type {
  EpisodeAdSkipConfig,
  PersistedAdSkipWindow,
} from './ad-skip-window';
import type { AiFindResponse } from './ai-find/types';

export type { EpisodeAdSkipConfig, PersistedAdSkipWindow };

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
  /** Resume-route preference — not part of Watch Progress identity. */
  route_source?: string;
  /** Resume-route preference — not part of Watch Progress identity. */
  route_id?: string;
}

// 片头片尾数据结构
export interface SkipSegment {
  id?: string; // 稳定标识，旧数据迁移后补齐
  start: number; // 开始时间（秒）
  end: number; // 结束时间（秒）
  type: 'opening' | 'ending'; // 片头或片尾
  title?: string; // 可选的描述
}

// 剧集跳过配置
export interface EpisodeSkipConfig {
  source: string; // 资源站标识
  id: string; // 剧集ID
  title: string; // 剧集标题
  segments: SkipSegment[]; // 跳过片段列表
  updated_time: number; // 最后更新时间
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

export type AiFindSavedRecordStatus = 'partial' | 'complete';

export interface AiFindSavedRecord {
  id: string;
  userName: string;
  query: string;
  response: AiFindResponse;
  status: AiFindSavedRecordStatus;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  openedCount: number;
}

export interface AiFindSavedRecordSummary {
  id: string;
  query: string;
  answer: string;
  candidateCount: number;
  foundGroupCount: number;
  status: AiFindSavedRecordStatus;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  openedCount: number;
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  getRecentPlayRecords?(
    userName: string,
    limit: number
  ): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;
  clearAllPlayRecords?(userName: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 将旧的明文密码升级为安全哈希
  upgradeLegacyPasswords?(): Promise<number>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // AI 找片结果记录相关
  getAiFindSavedRecords(userName: string): Promise<AiFindSavedRecordSummary[]>;
  getAiFindSavedRecord(
    userName: string,
    id: string
  ): Promise<AiFindSavedRecord | null>;
  upsertAiFindSavedRecord(
    userName: string,
    record: AiFindSavedRecord
  ): Promise<void>;
  touchAiFindSavedRecord(userName: string, id: string): Promise<void>;
  deleteAiFindSavedRecord(userName: string, id: string): Promise<void>;
  clearAiFindSavedRecords(userName: string): Promise<void>;

  // 片头片尾跳过配置相关
  getSkipConfig(
    userName: string,
    key: string
  ): Promise<EpisodeSkipConfig | null>;
  setSkipConfig(
    userName: string,
    key: string,
    config: EpisodeSkipConfig
  ): Promise<void>;
  getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }>;
  deleteSkipConfig(userName: string, key: string): Promise<void>;

  // Ad Skip Window（同部署共享；localstorage 模式在客户端降级为自用）
  getAdSkipConfig(key: string): Promise<EpisodeAdSkipConfig | null>;
  setAdSkipConfig(key: string, config: EpisodeAdSkipConfig): Promise<void>;
  getAllAdSkipConfigs(): Promise<{ [key: string]: EpisodeAdSkipConfig }>;
  deleteAdSkipConfig(key: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

export type SourcePlaybackMode = 'direct' | 'proxy';

export type SourceStatusKind =
  | 'idle'
  | 'probing'
  | 'direct'
  | 'proxy'
  | 'playable'
  | 'unavailable';

export interface SourceVideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  speedSource?: 'backend' | 'browser' | 'feedback' | 'none';
  speedUpdatedAt?: number;
  speedPending?: boolean;
  hasError?: boolean;
  errorReason?: string;
}

export interface SourceStatus {
  kind: SourceStatusKind;
  reason?: string;
  playbackMode?: SourcePlaybackMode;
  domain?: string | null;
  measured?: SourceVideoInfo;
  updatedAt?: number;
  fromMemory?: boolean;
  rankingSource?: 'd1' | 'live';
  rankScore?: number;
  localConfidence?: 'low' | 'medium' | 'high';
}

export interface SourceDomainPreference {
  mode: SourcePlaybackMode | 'unavailable';
  failCount: number;
  updatedAt: number;
  lastError?: string;
}

export interface SourcePlaybackQualityPreference {
  mode: SourcePlaybackMode | 'unavailable';
  lastPlayableAt?: number;
  lastFailedAt?: number;
  startupTimeMs?: number;
  observedSpeedKbps?: number;
  browserSpeedLabel?: string;
  stallCount?: number;
  confidence?: 'low' | 'medium' | 'high';
  lastError?: string;
  updatedAt: number;
}

export interface SourceProbeResult {
  kind: 'direct' | 'proxy' | 'unavailable';
  reason?: string;
  domain?: string | null;
  upstreamStatus?: number;
}

export interface SourcePreferenceResult extends SourceProbeResult {
  sourceKey: string;
  probeTimeMs?: number;
  cacheState?: 'hit' | 'miss';
  qualityLabel?: string | null;
  speedLabel?: string | null;
  speedSource?: 'backend' | 'browser' | 'feedback' | 'none';
  speedUpdatedAt?: number;
  speedPending?: boolean;
  pingTimeMs?: number | null;
  latencyMs?: number | null;
  speedKbps?: number | null;
  updatedAt?: number;
  rankingSource?: 'd1' | 'live';
  rankScore?: number;
}

export interface SourcePreferenceRequest {
  allowLiveProbeFallback?: boolean;
  includeFreshProbeMetrics?: boolean;
  sources: Array<{
    sourceKey: string;
    episodeUrl: string | null;
    sourceName?: string;
    titleSample?: string;
  }>;
}

export interface SourcePreferenceResponse {
  orderedSourceKeys: string[];
  results: SourcePreferenceResult[];
  generatedAt: number;
  rankingSource?: 'd1' | 'live' | 'mixed';
  confidence?: 'low' | 'medium';
}

export interface PlaybackFeedbackInput {
  sourceKey: string;
  platform?: 'apple-hlsjs' | 'android-hlsjs' | 'desktop-hlsjs';
  playbackDomain?: string | null;
  title?: string;
  playbackMode: SourcePlaybackMode;
  startupSuccess: boolean;
  startupTimeMs?: number;
  switchedToProxy?: boolean;
  browserQuality?: string;
  browserPingMs?: number;
  browserSpeedLabel?: string;
  sessionError?: string;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// Runtime配置类型
export interface RuntimeConfig {
  STORAGE_TYPE?: string;
  ENABLE_REGISTER?: boolean;
  IMAGE_PROXY?: string;
  DOUBAN_PROXY?: string;
  SOURCE_PROBE?: string;
  HLS_PROXY?: string;
  SOURCE_RANKING_ENABLED?: boolean;
  TURNSTILE_SITE_KEY?: string;
  LOGIN_TURNSTILE_REQUIRED?: boolean;
  REGISTER_INVITE_REQUIRED?: boolean;
  CURRENT_USER?: {
    username?: string | null;
    role?: 'owner' | 'admin' | 'user';
  } | null;
}

// 全局Window类型扩展
declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
  }
}
