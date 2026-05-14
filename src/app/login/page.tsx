'use client';

export const runtime = 'edge';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import IOSCompatibility from '@/components/IOSCompatibility';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginPageClient() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = window.RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
      setEnableRegister(Boolean(window.RUNTIME_CONFIG?.ENABLE_REGISTER));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        window.location.href = redirect;
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 处理注册逻辑
  const handleRegister = async () => {
    setError(null);
    if (!password || !username) return;

    try {
      setLoading(true);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        window.location.href = redirect;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <IOSCompatibility>
      <div className='ui-app-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 text-[rgb(var(--ui-text))]'>
        <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.06)_42%,transparent_68%)] opacity-60' />

        <div className='absolute top-4 right-4'>
          <ThemeToggle />
        </div>

        <div className='ui-shell-panel relative z-10 w-full max-w-md rounded-ui-lg border border-white/10 p-8 shadow-ui-strong sm:p-10'>
          <div className='mb-8 text-center'>
            <p className='mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--ui-accent-warm))]'>
              KatelyaTV
            </p>
            <h1 className='text-3xl font-semibold tracking-tight text-[rgb(var(--ui-text))]'>
              {siteName}
            </h1>
            <p className='mt-3 text-sm text-[rgb(var(--ui-text-muted))]'>
              输入访问凭证后继续观看
            </p>
          </div>

          <h2 className='sr-only'>登录</h2>

          <form onSubmit={handleSubmit} className='space-y-8'>
            {shouldAskUsername && (
              <div>
                <label htmlFor='username' className='sr-only'>
                  用户名
                </label>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full rounded-ui-sm border border-white/10 bg-white/5 px-4 py-3 text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--ui-accent),0.34)] sm:text-base'
                  placeholder='输入用户名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}

            <div>
              <label htmlFor='password' className='sr-only'>
                密码
              </label>
              <input
                id='password'
                type='password'
                autoComplete='current-password'
                className='block w-full rounded-ui-sm border border-white/10 bg-white/5 px-4 py-3 text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--ui-accent),0.34)] sm:text-base'
                placeholder='输入访问密码'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className='rounded-ui-sm border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                {error}
              </p>
            )}

            {/* 登录 / 注册按钮 */}
            {shouldAskUsername && enableRegister ? (
              <div className='flex gap-4'>
                <button
                  type='button'
                  onClick={handleRegister}
                  disabled={!password || !username || loading}
                  className='inline-flex flex-1 justify-center rounded-ui-sm border border-white/10 bg-white/10 py-3 text-base font-semibold text-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-200 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {loading ? '注册中...' : '注册'}
                </button>
                <button
                  type='submit'
                  disabled={
                    !password || loading || (shouldAskUsername && !username)
                  }
                  className='inline-flex flex-1 justify-center rounded-ui-sm bg-[rgb(var(--ui-accent))] py-3 text-base font-semibold text-white shadow-ui-soft transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {loading ? '登录中...' : '登录'}
                </button>
              </div>
            ) : (
              <button
                type='submit'
                disabled={
                  !password || loading || (shouldAskUsername && !username)
                }
                className='inline-flex w-full justify-center rounded-ui-sm bg-[rgb(var(--ui-accent))] py-3 text-base font-semibold text-white shadow-ui-soft transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {loading ? '登录中...' : '登录'}
              </button>
            )}
          </form>
        </div>
      </div>
    </IOSCompatibility>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
