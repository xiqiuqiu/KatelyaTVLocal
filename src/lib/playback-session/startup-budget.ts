import type {
  PlaybackSessionEffect,
  PlaybackSessionState,
  VideoSnapshot,
} from './types';

export const STARTUP_BUDGET_MS = 30_000;
export const STARTUP_SOURCE_TIMEOUT_MS = 10_000;

export interface StartupBudgetState {
  status:
    | 'active'
    | 'waiting-choice'
    | 'selecting-source'
    | 'succeeded'
    | 'cancelled';
  mode: 'play' | 'sources-only';
  activeWaitMs: number;
  lastTickMs: number;
  hidden: boolean;
  paused: boolean;
  autoplayBlocked: boolean;
  sourceWaitMs: number;
  sourceAttemptId: number | null;
  sourceKey: string | null;
  sourceClockRunning: boolean;
  failedSourceKeys: Set<string>;
  interruptedSourceKey: string | null;
}

export type StartupBudgetEvent =
  | {
      type: 'startup.started';
      nowMs: number;
      startedAtMs?: number;
      hidden?: boolean;
    }
  | {
      type: 'startup.activity';
      nowMs: number;
      hidden?: boolean;
      paused?: boolean;
      autoplayBlocked?: boolean;
    }
  | { type: 'startup.tick'; nowMs: number; snapshot?: VideoSnapshot }
  | { type: 'startup.frame'; nowMs: number; attemptId: number }
  | { type: 'startup.retry'; nowMs: number; mode?: StartupBudgetState['mode'] }
  | { type: 'startup.chooseSource'; nowMs: number }
  | { type: 'startup.sourcesReady'; nowMs: number }
  | { type: 'startup.cancel'; nowMs: number }
  | {
      type: 'startup.sourceFailed';
      attemptId: number;
      sourceKey: string;
      nowMs?: number;
    };

export function isStartupWorkAllowed(
  state: Pick<PlaybackSessionState, 'startup'>
): boolean {
  const startup = state.startup;
  return (
    !startup ||
    startup.status === 'succeeded' ||
    (startup.status === 'active' &&
      startup.mode === 'play' &&
      !startup.hidden &&
      !startup.paused &&
      !startup.autoplayBlocked &&
      startup.activeWaitMs < STARTUP_BUDGET_MS)
  );
}

function advanceClock(
  startup: StartupBudgetState,
  nowMs: number
): StartupBudgetState {
  const elapsed = Math.max(0, nowMs - startup.lastTickMs);
  const runs =
    startup.status === 'active' &&
    !startup.hidden &&
    !startup.paused &&
    !startup.autoplayBlocked;
  return {
    ...startup,
    lastTickMs: Math.max(startup.lastTickMs, nowMs),
    activeWaitMs: startup.activeWaitMs + (runs ? elapsed : 0),
    sourceWaitMs:
      startup.sourceWaitMs + (runs && startup.sourceClockRunning ? elapsed : 0),
  };
}

function newRound(
  nowMs: number,
  hidden: boolean,
  mode: StartupBudgetState['mode'],
  failedSourceKeys = new Set<string>()
): StartupBudgetState {
  return {
    status: 'active',
    mode,
    activeWaitMs: 0,
    lastTickMs: nowMs,
    hidden,
    paused: false,
    autoplayBlocked: false,
    sourceWaitMs: 0,
    sourceAttemptId: null,
    sourceKey: null,
    sourceClockRunning: false,
    failedSourceKeys,
    interruptedSourceKey: null,
  };
}

function expire(startup: StartupBudgetState): {
  startup: StartupBudgetState;
  effects: PlaybackSessionEffect[];
} {
  if (startup.status !== 'active') return { startup, effects: [] };
  if (startup.activeWaitMs >= STARTUP_BUDGET_MS) {
    const interruptedSourceKey =
      startup.sourceKey && !startup.failedSourceKeys.has(startup.sourceKey)
        ? startup.sourceKey
        : null;
    return {
      startup: {
        ...startup,
        status: 'waiting-choice',
        activeWaitMs: STARTUP_BUDGET_MS,
        sourceClockRunning: false,
        interruptedSourceKey,
      },
      effects: [
        {
          type: 'startupBudgetExhausted',
          sourceKey: interruptedSourceKey,
          attemptId: startup.sourceAttemptId,
        },
      ],
    };
  }
  if (
    startup.sourceClockRunning &&
    startup.sourceWaitMs >= STARTUP_SOURCE_TIMEOUT_MS &&
    startup.sourceAttemptId !== null &&
    startup.sourceKey
  ) {
    return {
      startup: {
        ...startup,
        sourceClockRunning: false,
        sourceWaitMs: STARTUP_SOURCE_TIMEOUT_MS,
      },
      effects: [
        {
          type: 'startupSourceTimeout',
          attemptId: startup.sourceAttemptId,
          sourceKey: startup.sourceKey,
        },
      ],
    };
  }
  return { startup, effects: [] };
}

/** All nowMs values here use the same monotonic clock; recovery keeps its wall clock. */
export function reduceStartupBudget(
  current: StartupBudgetState | null,
  event: StartupBudgetEvent
): { startup: StartupBudgetState | null; effects: PlaybackSessionEffect[] } {
  if (event.type === 'startup.started') {
    const startup = newRound(event.nowMs, Boolean(event.hidden), 'play');
    startup.activeWaitMs = event.hidden
      ? 0
      : Math.max(0, event.nowMs - (event.startedAtMs ?? event.nowMs));
    return expire(startup);
  }
  if (!current) return { startup: current, effects: [] };
  if (event.type === 'startup.retry') {
    return {
      startup: newRound(
        event.nowMs,
        current.hidden,
        event.mode || 'play',
        current.failedSourceKeys
      ),
      effects: [],
    };
  }
  let startup =
    event.nowMs === undefined ? current : advanceClock(current, event.nowMs);
  switch (event.type) {
    case 'startup.cancel':
      return {
        startup: { ...startup, status: 'cancelled', sourceClockRunning: false },
        effects: [],
      };
    case 'startup.chooseSource':
      return {
        startup: {
          ...startup,
          status: 'selecting-source',
          sourceClockRunning: false,
        },
        effects: [],
      };
    case 'startup.sourcesReady':
      if (startup.activeWaitMs >= STARTUP_BUDGET_MS) return expire(startup);
      if (startup.status === 'active' && startup.mode === 'sources-only') {
        return {
          startup: {
            ...startup,
            status: 'selecting-source',
            sourceClockRunning: false,
          },
          effects: [],
        };
      }
      return { startup, effects: [] };
    case 'startup.frame':
      if (
        current.status !== 'active' ||
        current.mode !== 'play' ||
        current.hidden ||
        current.paused ||
        current.autoplayBlocked ||
        current.sourceAttemptId !== event.attemptId
      ) {
        return expire(startup);
      }
      if (startup.activeWaitMs <= STARTUP_BUDGET_MS) {
        return {
          startup: {
            ...startup,
            status: 'succeeded',
            sourceClockRunning: false,
            failedSourceKeys: new Set(
              Array.from(startup.failedSourceKeys).filter(
                (key) => key !== startup.sourceKey
              )
            ),
          },
          effects: [],
        };
      }
      return expire(startup);
    case 'startup.sourceFailed':
      if (startup.activeWaitMs >= STARTUP_BUDGET_MS) return expire(startup);
      if (
        startup.status === 'active' &&
        startup.sourceAttemptId === event.attemptId &&
        startup.sourceKey === event.sourceKey
      ) {
        startup = {
          ...startup,
          sourceClockRunning: false,
          failedSourceKeys: new Set(
            Array.from(startup.failedSourceKeys).concat(event.sourceKey)
          ),
        };
      }
      return expire(startup);
    case 'startup.activity': {
      const expired = expire(startup);
      return {
        startup: {
          ...expired.startup,
          hidden: event.hidden ?? startup.hidden,
          paused: event.paused ?? startup.paused,
          autoplayBlocked: event.autoplayBlocked ?? startup.autoplayBlocked,
        },
        effects: expired.effects,
      };
    }
    case 'startup.tick':
      return expire(startup);
  }
}
