export type PlaybackPreparationPhase =
  | 'idle'
  | 'entering'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'returning';

export type PlaybackPreparationRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PlaybackPreparationIntent = {
  href: string;
  cardKey: string;
  title: string;
  poster: string;
  year?: string;
  rect: PlaybackPreparationRect;
  origin: {
    href: string;
    scrollY: number;
  };
};

export type PlaybackPreparationState = {
  phase: PlaybackPreparationPhase;
  generation: number;
  intent: PlaybackPreparationIntent | null;
};

export type PlaybackPreparationEvent =
  | {
      type: 'start';
      generation: number;
      intent: PlaybackPreparationIntent;
    }
  | { type: 'frameReady'; generation: number }
  | { type: 'terminalFailure'; generation: number }
  | { type: 'cancel'; generation: number }
  | { type: 'return'; generation: number }
  | { type: 'returnComplete'; generation: number };

export function createPlaybackPreparationState(): PlaybackPreparationState {
  return {
    phase: 'idle',
    generation: 0,
    intent: null,
  };
}

export function reducePlaybackPreparationTransition(
  state: PlaybackPreparationState,
  event: PlaybackPreparationEvent
): PlaybackPreparationState {
  switch (event.type) {
    case 'start':
      return {
        phase: 'entering',
        generation: event.generation,
        intent: event.intent,
      };
    case 'frameReady':
      if (
        event.generation !== state.generation ||
        (state.phase !== 'entering' && state.phase !== 'preparing')
      ) {
        return state;
      }
      return { ...state, phase: 'ready' };
    case 'terminalFailure':
      if (
        event.generation !== state.generation ||
        (state.phase !== 'entering' && state.phase !== 'preparing')
      ) {
        return state;
      }
      return { ...state, phase: 'failed' };
    case 'cancel':
    case 'return':
      if (
        event.generation !== state.generation ||
        state.phase === 'idle' ||
        state.phase === 'returning'
      ) {
        return state;
      }
      return { ...state, phase: 'returning' };
    case 'returnComplete':
      if (
        event.generation !== state.generation ||
        state.phase !== 'returning'
      ) {
        return state;
      }
      return createPlaybackPreparationState();
  }
}
