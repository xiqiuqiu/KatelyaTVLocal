type RuntimeSource = Record<string, unknown>;

function readString(source: RuntimeSource, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readCronApiToken(source?: RuntimeSource): string | null {
  const runtime = source || (process.env as unknown as RuntimeSource);
  return readString(runtime, 'CRON_API_TOKEN');
}

export function readCronRequestToken(
  request: Pick<Request, 'headers'>
): string | null {
  const explicitToken = request.headers.get('x-cron-token')?.trim();
  if (explicitToken) {
    return explicitToken;
  }

  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization) {
    return null;
  }

  const bearerPrefix = 'Bearer ';
  if (!authorization.startsWith(bearerPrefix)) {
    return null;
  }

  const token = authorization.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
}

export function isAuthorizedCronRequest(
  request: Pick<Request, 'headers'>,
  source?: RuntimeSource
): boolean {
  const expectedToken = readCronApiToken(source);
  if (!expectedToken) {
    return false;
  }

  const incomingToken = readCronRequestToken(request);
  return incomingToken === expectedToken;
}
