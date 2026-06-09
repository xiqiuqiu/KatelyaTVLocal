export type PlaybackDebugRuntime = 'hlsjs' | 'native-hls' | string;
export type PlaybackDebugPlaylistFilter =
  | 'client-observe'
  | 'proxy-observe'
  | string;
export type PlaybackDebugSegmentMode = 'direct' | 'proxy' | string;
export type PlaybackDebugRecoveryProfile = 'hlsjs' | 'native-video' | string;

export interface PlaybackDebugLogInput {
  sessionId: string;
  eventType: string;
  sourceKey?: string | null;
  playbackUrl?: string | null;
  title?: string | null;
  runtime?: PlaybackDebugRuntime | null;
  playlistFilter?: PlaybackDebugPlaylistFilter | null;
  segmentMode?: PlaybackDebugSegmentMode | null;
  recoveryProfile?: PlaybackDebugRecoveryProfile | null;
  currentTime?: number | null;
  duration?: number | null;
  readyState?: number | null;
  networkState?: number | null;
  paused?: boolean | null;
  ended?: boolean | null;
  details?: unknown;
  userAgent?: string | null;
}

export interface PlaybackDebugLogEntry extends PlaybackDebugLogInput {
  id: string;
  playbackDomain: string | null;
  createdAt: number;
}

type RuntimeEnv = Record<string, unknown>;
type D1DatabaseLike = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run?: () => Promise<unknown>;
      all?: () => Promise<{ results?: unknown[] }>;
    };
  };
};

function getD1(env: RuntimeEnv): D1DatabaseLike | null {
  const db = env.DB;
  if (db && typeof (db as D1DatabaseLike).prepare === 'function') {
    return db as D1DatabaseLike;
  }
  return null;
}

export function hasPlaybackDebugD1(env: RuntimeEnv): boolean {
  return Boolean(getD1(env));
}

function toLimitedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toBooleanNumber(value: unknown): number | null {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return null;
}

function getPlaybackDomain(playbackUrl: string | null): string | null {
  if (!playbackUrl) {
    return null;
  }
  try {
    return new URL(playbackUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stringifyDetails(details: unknown): string | null {
  if (details == null) {
    return null;
  }

  try {
    return JSON.stringify(details).slice(0, 6000);
  } catch {
    return JSON.stringify({ value: String(details) }).slice(0, 6000);
  }
}

function parseDetails(detailsJson: unknown): unknown {
  if (typeof detailsJson !== 'string' || detailsJson.length === 0) {
    return null;
  }

  try {
    return JSON.parse(detailsJson);
  } catch {
    return detailsJson;
  }
}

function createLogId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `playback-debug-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function normalizeInput(input: PlaybackDebugLogInput) {
  const playbackUrl = toLimitedString(input.playbackUrl, 2048);
  return {
    sessionId: toLimitedString(input.sessionId, 128),
    eventType: toLimitedString(input.eventType, 80),
    sourceKey: toLimitedString(input.sourceKey, 160),
    playbackUrl,
    playbackDomain: getPlaybackDomain(playbackUrl),
    title: toLimitedString(input.title, 200),
    runtime: toLimitedString(input.runtime, 40),
    playlistFilter: toLimitedString(input.playlistFilter, 40),
    segmentMode: toLimitedString(input.segmentMode, 40),
    recoveryProfile: toLimitedString(input.recoveryProfile, 40),
    currentTime: toFiniteNumber(input.currentTime),
    duration: toFiniteNumber(input.duration),
    readyState: toFiniteNumber(input.readyState),
    networkState: toFiniteNumber(input.networkState),
    paused: toBooleanNumber(input.paused),
    ended: toBooleanNumber(input.ended),
    detailsJson: stringifyDetails(input.details),
    userAgent: toLimitedString(input.userAgent, 500),
  };
}

export async function savePlaybackDebugLog(
  env: RuntimeEnv,
  input: PlaybackDebugLogInput
): Promise<boolean> {
  const db = getD1(env);
  if (!db) {
    return false;
  }

  const normalized = normalizeInput(input);
  if (!normalized.sessionId || !normalized.eventType) {
    return false;
  }

  await db
    .prepare(
      `INSERT INTO playback_debug_logs (
        id,
        session_id,
        event_type,
        source_key,
        playback_url,
        playback_domain,
        title,
        runtime,
        playlist_filter,
        segment_mode,
        recovery_profile,
        current_time,
        duration,
        ready_state,
        network_state,
        paused,
        ended,
        details_json,
        user_agent,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      createLogId(),
      normalized.sessionId,
      normalized.eventType,
      normalized.sourceKey,
      normalized.playbackUrl,
      normalized.playbackDomain,
      normalized.title,
      normalized.runtime,
      normalized.playlistFilter,
      normalized.segmentMode,
      normalized.recoveryProfile,
      normalized.currentTime,
      normalized.duration,
      normalized.readyState,
      normalized.networkState,
      normalized.paused,
      normalized.ended,
      normalized.detailsJson,
      normalized.userAgent,
      Date.now()
    )
    .run?.();

  return true;
}

export async function listPlaybackDebugLogs(
  env: RuntimeEnv,
  requestedLimit = 100
): Promise<PlaybackDebugLogEntry[]> {
  const db = getD1(env);
  if (!db) {
    return [];
  }

  const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit || 100)));
  const result = await db
    .prepare(
      `SELECT
        id,
        session_id,
        event_type,
        source_key,
        playback_url,
        playback_domain,
        title,
        runtime,
        playlist_filter,
        segment_mode,
        recovery_profile,
        current_time,
        duration,
        ready_state,
        network_state,
        paused,
        ended,
        details_json,
        user_agent,
        created_at
      FROM playback_debug_logs
      ORDER BY created_at DESC
      LIMIT ?`
    )
    .bind(limit)
    .all?.();

  return ((result?.results || []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id || ''),
    sessionId: String(row.session_id || ''),
    eventType: String(row.event_type || ''),
    sourceKey: (row.source_key as string | null) || null,
    playbackUrl: (row.playback_url as string | null) || null,
    playbackDomain: (row.playback_domain as string | null) || null,
    title: (row.title as string | null) || null,
    runtime: (row.runtime as string | null) || null,
    playlistFilter: (row.playlist_filter as string | null) || null,
    segmentMode: (row.segment_mode as string | null) || null,
    recoveryProfile: (row.recovery_profile as string | null) || null,
    currentTime: toFiniteNumber(row.current_time),
    duration: toFiniteNumber(row.duration),
    readyState: toFiniteNumber(row.ready_state),
    networkState: toFiniteNumber(row.network_state),
    paused: typeof row.paused === 'number' ? row.paused === 1 : null,
    ended: typeof row.ended === 'number' ? row.ended === 1 : null,
    details: parseDetails(row.details_json),
    userAgent: (row.user_agent as string | null) || null,
    createdAt: Number(row.created_at || 0),
  }));
}
