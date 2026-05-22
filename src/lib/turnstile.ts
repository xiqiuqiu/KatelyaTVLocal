export interface TurnstileVerifyInput {
  token?: string;
  ip: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
}

export interface TurnstileVerifyResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function getClientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anonymous'
  );
}

export async function verifyTurnstileToken({
  token,
  ip,
  secretKey,
  fetchImpl,
}: TurnstileVerifyInput): Promise<TurnstileVerifyResult> {
  if (!token) {
    return { ok: false, status: 400, error: '请先完成人机验证' };
  }

  if (!secretKey) {
    return { ok: false, status: 500, error: 'Turnstile 未配置' };
  }

  const verifyFetch = fetchImpl ?? fetch;
  const form = new FormData();
  form.set('secret', secretKey);
  form.set('response', token);
  if (ip && ip !== 'anonymous') {
    form.set('remoteip', ip);
  }

  const response = await verifyFetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: form,
    }
  );
  const result = (await response.json().catch(() => null)) as {
    success?: boolean;
  } | null;

  if (!response.ok || !result?.success) {
    return { ok: false, status: 400, error: '人机验证失败，请重试' };
  }

  return { ok: true, status: 200 };
}
