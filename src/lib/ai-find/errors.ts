export class AiFindUserFacingError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor({
    message,
    publicMessage,
    status = 502,
  }: {
    message: string;
    publicMessage: string;
    status?: number;
  }) {
    super(message);
    this.name = 'AiFindUserFacingError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function isAiFindUserFacingError(
  error: unknown
): error is AiFindUserFacingError {
  return error instanceof AiFindUserFacingError;
}

export function isAiFindAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name === 'AbortError') {
    return true;
  }

  return (
    typeof candidate.message === 'string' &&
    /\babort(?:ed)?\b/i.test(candidate.message)
  );
}
