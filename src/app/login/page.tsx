'use client';

export const runtime = 'edge';

import {
  ArrowRight,
  Clapperboard,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import IOSCompatibility from '@/components/IOSCompatibility';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

declare global {
  interface Window {
    turnstile?: {
      render: (
        selector: string | Element,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

function LoginPageClient() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [registerInviteRequired, setRegisterInviteRequired] = useState(true);
  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = window.RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
      setEnableRegister(Boolean(window.RUNTIME_CONFIG?.ENABLE_REGISTER));
      setTurnstileSiteKey(window.RUNTIME_CONFIG?.TURNSTILE_SITE_KEY || '');
      setRegisterInviteRequired(
        window.RUNTIME_CONFIG?.REGISTER_INVITE_REQUIRED !== false
      );
    }
  }, []);

  useEffect(() => {
    const shouldRenderTurnstile = enableRegister && turnstileSiteKey;
    if (!shouldRenderTurnstile) return;

    const scriptId = 'cf-turnstile-script';
    const renderTurnstile = () => {
      if (!window.turnstile || !document.getElementById('register-turnstile')) {
        return;
      }

      const container = document.getElementById('register-turnstile');
      if (!container || container.dataset.rendered === 'true') {
        return;
      }

      window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
      container.dataset.rendered = 'true';
    };

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = renderTurnstile;
      document.head.appendChild(script);
    } else {
      renderTurnstile();
    }
  }, [enableRegister, turnstileSiteKey]);

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
    if (registerInviteRequired && !inviteCode.trim()) {
      setError('请输入邀请码');
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError('请先完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          inviteCode,
          turnstileToken,
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        window.location.href = redirect;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
        window.turnstile?.reset();
        setTurnstileToken('');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <IOSCompatibility>
      <main className='relative min-h-screen overflow-hidden bg-[rgb(var(--ui-bg))] text-[rgb(var(--ui-text))]'>
        <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,rgb(255_255_255/0.055)_42%,transparent_68%)] opacity-70' />
        <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--ui-accent)/0.8),rgb(var(--ui-accent-warm)/0.58),transparent)]' />
        <div className='pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgb(var(--ui-border)/0.34)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--ui-border)/0.26)_1px,transparent_1px)] [background-size:72px_72px]' />

        <div className='absolute right-4 top-4 z-20 sm:right-6 sm:top-6'>
          <ThemeToggle />
        </div>

        <div className='relative z-10 mx-auto grid min-h-screen w-full max-w-6xl items-center gap-8 px-4 py-24 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8'>
          <section className='relative hidden min-h-[560px] overflow-hidden rounded-ui-lg border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg-elevated)/0.62)] shadow-ui-strong backdrop-blur-2xl lg:block'>
            <div className='absolute inset-0 bg-[linear-gradient(135deg,rgb(var(--ui-accent)/0.2),transparent_34%,rgb(var(--ui-accent-warm)/0.12)_76%,transparent)]' />
            <div className='absolute inset-x-8 top-8 flex items-center justify-between text-xs font-semibold text-[rgb(var(--ui-text-muted))]'>
              <span>PRIVATE SCREENING</span>
              <span>ACCESS GATE</span>
            </div>
            <div className='relative flex h-full flex-col justify-between p-10 pt-24'>
              <div className='max-w-lg'>
                <div className='mb-8 flex h-20 w-20 items-center justify-center rounded-ui-lg border border-[rgb(var(--ui-border)/0.8)] bg-[rgb(var(--ui-surface)/0.82)] shadow-ui-soft'>
                  <Image
                    src='/logo.png'
                    alt=''
                    width={56}
                    height={56}
                    priority
                    className='h-14 w-14 rounded-ui-sm object-cover'
                  />
                </div>

                <p className='mb-4 text-sm font-semibold uppercase text-[rgb(var(--ui-accent-warm))]'>
                  {siteName}
                </p>
                <h1 className='max-w-xl text-5xl font-semibold leading-tight text-[rgb(var(--ui-text))]'>
                  {siteName}
                </h1>
                <p className='mt-5 max-w-md text-base leading-7 text-[rgb(var(--ui-text-muted))]'>
                  进入你的私人影视空间，继续上次停下的片刻。
                </p>
              </div>

              <div className='grid grid-cols-3 gap-3'>
                {[
                  ['聚合', '片源'],
                  ['继续', '观看'],
                  ['私密', '访问'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className='rounded-ui-sm border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-surface)/0.54)] p-4 shadow-ui-soft'
                  >
                    <p className='text-xs text-[rgb(var(--ui-text-muted))]'>
                      {label}
                    </p>
                    <p className='mt-2 text-lg font-semibold text-[rgb(var(--ui-text))]'>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className='mx-auto w-full max-w-md lg:max-w-none'>
            <div className='mb-6 flex items-center gap-4 lg:hidden'>
              <div className='flex h-14 w-14 items-center justify-center rounded-ui-md border border-[rgb(var(--ui-border)/0.8)] bg-[rgb(var(--ui-surface)/0.8)] shadow-ui-soft'>
                <Image
                  src='/logo.png'
                  alt=''
                  width={40}
                  height={40}
                  priority
                  className='h-10 w-10 rounded-ui-sm object-cover'
                />
              </div>
              <div>
                <p className='text-sm font-semibold text-[rgb(var(--ui-accent-warm))]'>
                  {siteName}
                </p>
                <h1 className='text-2xl font-semibold text-[rgb(var(--ui-text))]'>
                  {siteName}
                </h1>
              </div>
            </div>

            <div className='ui-shell-panel relative overflow-hidden rounded-ui-lg p-6 shadow-ui-strong sm:p-8'>
              <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--ui-accent)/0.78),transparent)]' />

              <div className='mb-8 flex items-start justify-between gap-4'>
                <div>
                  <div className='mb-5 inline-flex items-center gap-2 rounded-ui-sm border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg-elevated)/0.68)] px-3 py-2 text-xs font-semibold text-[rgb(var(--ui-text-muted))]'>
                    <ShieldCheck className='h-4 w-4 text-[rgb(var(--ui-success))]' />
                    安全访问
                  </div>
                  <h2 className='text-2xl font-semibold text-[rgb(var(--ui-text))]'>
                    登录
                  </h2>
                  <p className='mt-2 text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
                    输入访问凭证后继续观看
                  </p>
                </div>

                <div className='hidden h-12 w-12 items-center justify-center rounded-ui-md border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg-elevated)/0.68)] text-[rgb(var(--ui-accent))] sm:flex'>
                  <Clapperboard className='h-6 w-6' />
                </div>
              </div>

              <form onSubmit={handleSubmit} className='space-y-5'>
                {shouldAskUsername && (
                  <div>
                    <label
                      htmlFor='username'
                      className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text-muted))]'
                    >
                      用户名
                    </label>
                    <div className='relative'>
                      <UserRound className='pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                      <input
                        id='username'
                        type='text'
                        autoComplete='username'
                        className='block w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg-elevated)/0.76)] py-3 pl-12 pr-4 text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.34)] sm:text-base'
                        placeholder='输入用户名'
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label
                    htmlFor='password'
                    className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text-muted))]'
                  >
                    访问密码
                  </label>
                  <div className='relative'>
                    <KeyRound className='pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                    <input
                      id='password'
                      type={showPassword ? 'text' : 'password'}
                      autoComplete='current-password'
                      className='block w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg-elevated)/0.76)] py-3 pl-12 pr-16 text-[rgb(var(--ui-text))] shadow-ui-soft selection:bg-[rgb(var(--ui-accent)/0.28)] selection:text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.34)] sm:text-base'
                      placeholder='输入访问密码'
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      className='absolute right-0 top-1/2 flex h-full w-16 -translate-y-1/2 items-center justify-center rounded-r-ui-sm text-[rgb(var(--ui-text-muted))] transition-colors duration-200 before:absolute before:inset-y-1 before:right-2 before:w-11 before:rounded-ui-sm before:border before:border-transparent before:bg-transparent before:transition-all before:duration-200 hover:text-[rgb(var(--ui-text))] hover:before:border-[rgb(var(--ui-border)/0.62)] hover:before:bg-[rgb(var(--ui-surface-strong)/0.44)] hover:before:shadow-ui-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ui-accent)/0.38)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--ui-bg))]'
                      onClick={() => setShowPassword((value) => !value)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setShowPassword(true)}
                      onMouseLeave={() => setShowPassword(false)}
                      type='button'
                    >
                      {showPassword ? (
                        <EyeOff className='relative h-5 w-5' />
                      ) : (
                        <Eye className='relative h-5 w-5' />
                      )}
                    </button>
                  </div>
                </div>

                {shouldAskUsername && enableRegister && (
                  <>
                    {registerInviteRequired && (
                      <div>
                        <label
                          htmlFor='inviteCode'
                          className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text-muted))]'
                        >
                          邀请码
                        </label>
                        <div className='relative'>
                          <Hash className='pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                          <input
                            id='inviteCode'
                            type='text'
                            autoComplete='off'
                            className='block w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg-elevated)/0.76)] py-3 pl-12 pr-4 text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.34)] sm:text-base'
                            placeholder='输入邀请码'
                            value={inviteCode}
                            onChange={(e) => setInviteCode(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {turnstileSiteKey ? (
                      <div id='register-turnstile' className='min-h-[65px]' />
                    ) : (
                      <p className='rounded-ui-sm border border-[rgb(var(--ui-critical)/0.36)] bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                        注册人机验证尚未配置，请稍后再试。
                      </p>
                    )}
                  </>
                )}

                {error && (
                  <p
                    role='alert'
                    className='rounded-ui-sm border border-[rgb(var(--ui-critical)/0.36)] bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-text))]'
                  >
                    {error}
                  </p>
                )}

                {shouldAskUsername && enableRegister ? (
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <button
                      type='button'
                      onClick={handleRegister}
                      disabled={
                        !password ||
                        !username ||
                        loading ||
                        !turnstileSiteKey ||
                        !turnstileToken ||
                        (registerInviteRequired && !inviteCode.trim())
                      }
                      className='inline-flex min-h-12 items-center justify-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-surface-strong)/0.7)] px-4 py-3 text-base font-semibold text-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-200 hover:bg-[rgb(var(--ui-surface-strong)/0.92)] disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      {loading ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          注册中...
                        </>
                      ) : (
                        '注册'
                      )}
                    </button>
                    <button
                      type='submit'
                      disabled={
                        !password ||
                        loading ||
                        (shouldAskUsername && !username)
                      }
                      className='inline-flex min-h-12 items-center justify-center rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-3 text-base font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      {loading ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          登录中...
                        </>
                      ) : (
                        <>
                          登录
                          <ArrowRight className='ml-2 h-4 w-4' />
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    type='submit'
                    disabled={
                      !password ||
                      loading ||
                      (shouldAskUsername && !username)
                    }
                    className='inline-flex min-h-12 w-full items-center justify-center rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-3 text-base font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    {loading ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        登录中...
                      </>
                    ) : (
                      <>
                        登录
                        <ArrowRight className='ml-2 h-4 w-4' />
                      </>
                    )}
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      </main>
    </IOSCompatibility>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-screen items-center justify-center bg-[rgb(var(--ui-bg))] text-[rgb(var(--ui-text-muted))]'>
          Loading...
        </div>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
