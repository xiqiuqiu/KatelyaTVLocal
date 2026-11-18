import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

export interface TmdbCredentials {
  apiKey?: string;
  readToken?: string;
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * 读取 TMDB 凭据。
 *
 * Cloudflare Pages（next-on-pages）里 `process.env` 只有构建期变量，
 * 后台加的运行时变量要通过 `getRequestContext().env` 才拿得到；
 * 本地 dev 与 Node 部署则只有 process.env。两边都读一次。
 */
export function getTmdbCredentials(): TmdbCredentials {
  let runtimeEnv: Record<string, unknown> = {};
  try {
    const context = getOptionalRequestContext();
    runtimeEnv = (context?.env as Record<string, unknown>) ?? {};
  } catch {
    // 非 Cloudflare 运行时（本地 dev / Node / 测试）会抛错，忽略即可
    runtimeEnv = {};
  }

  const readToken =
    readString(runtimeEnv, 'TMDB_READ_TOKEN') ||
    readString(process.env, 'TMDB_READ_TOKEN');
  const apiKey =
    readString(runtimeEnv, 'TMDB_API_KEY') ||
    readString(process.env, 'TMDB_API_KEY');

  return {
    readToken: readToken || undefined,
    apiKey: apiKey || undefined,
  };
}

export function isTmdbConfigured(credentials = getTmdbCredentials()): boolean {
  return Boolean(credentials.readToken || credentials.apiKey);
}
