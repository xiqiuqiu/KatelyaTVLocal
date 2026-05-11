import { PlaybackFeedbackInput } from '@/lib/types';

interface D1Statement {
  bind: (...values: unknown[]) => {
    run: () => Promise<unknown>;
  };
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Statement;
}

type RuntimeSource = Record<string, unknown>;

function getSourceRankingDatabase(
  env?: RuntimeSource
): D1DatabaseLike | null {
  const source = env || (process.env as unknown as RuntimeSource);
  const dbBinding = source.DB;

  if (
    dbBinding &&
    typeof dbBinding === 'object' &&
    typeof (dbBinding as D1DatabaseLike).prepare === 'function'
  ) {
    return dbBinding as D1DatabaseLike;
  }

  return null;
}

function createFeedbackId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function savePlaybackFeedback(
  env: RuntimeSource | undefined,
  input: PlaybackFeedbackInput,
  recordedAt = Date.now()
): Promise<boolean> {
  const dbBinding = getSourceRankingDatabase(env);
  if (!dbBinding) {
    return false;
  }

  await dbBinding
    .prepare(
      `INSERT INTO playback_feedback_events
       (id, source_key, playback_domain, title, playback_mode, startup_success, startup_time_ms, switched_to_proxy, browser_quality, browser_ping_ms, browser_speed_label, session_error, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      createFeedbackId(),
      input.sourceKey,
      input.playbackDomain || null,
      input.title || null,
      input.playbackMode,
      input.startupSuccess ? 1 : 0,
      input.startupTimeMs ?? null,
      input.switchedToProxy ? 1 : 0,
      input.browserQuality || null,
      input.browserPingMs ?? null,
      input.browserSpeedLabel || null,
      input.sessionError || null,
      recordedAt
    )
    .run();

  return true;
}
