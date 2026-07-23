'use client';

export const runtime = 'edge';

import {
  Clock3,
  Eye,
  EyeOff,
  Hash,
  Layers3,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { getInviteCodeFromSearchParams } from '@/lib/registration/invite-link';

import IOSCompatibility from '@/components/IOSCompatibility';
import { ThemeToggle } from '@/components/ThemeToggle';

type AuthMode = 'login' | 'register';

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
  const [loginTurnstileRequired, setLoginTurnstileRequired] = useState(false);
  const [registerInviteRequired, setRegisterInviteRequired] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  useEffect(() => {
    const inviteCodeFromUrl = getInviteCodeFromSearchParams(searchParams);
    if (inviteCodeFromUrl) {
      setInviteCode(inviteCodeFromUrl);
      setAuthMode('register');
    }
  }, [searchParams]);

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = window.RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
      setEnableRegister(Boolean(window.RUNTIME_CONFIG?.ENABLE_REGISTER));
      setTurnstileSiteKey(window.RUNTIME_CONFIG?.TURNSTILE_SITE_KEY || '');
      setLoginTurnstileRequired(
        window.RUNTIME_CONFIG?.LOGIN_TURNSTILE_REQUIRED === true
      );
      setRegisterInviteRequired(
        window.RUNTIME_CONFIG?.REGISTER_INVITE_REQUIRED !== false
      );
    }
  }, []);

  useEffect(() => {
    setTurnstileToken('');
  }, [authMode]);

  useEffect(() => {
    const shouldRenderTurnstile =
      turnstileSiteKey &&
      ((authMode === 'register' && enableRegister) ||
        (authMode === 'login' && loginTurnstileRequired));
    if (!shouldRenderTurnstile) return;

    const scriptId = 'cf-turnstile-script';
    const turnstileId =
      authMode === 'login' ? 'login-turnstile' : 'register-turnstile';
    const renderTurnstile = () => {
      if (!window.turnstile || !document.getElementById(turnstileId)) {
        return;
      }

      const container = document.getElementById(turnstileId);
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
  }, [authMode, enableRegister, loginTurnstileRequired, turnstileSiteKey]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;
    if (loginTurnstileRequired && !turnstileToken) {
      setError('请先完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
          turnstileToken,
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

  const handleAuthSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (authMode === 'register') {
      e.preventDefault();
      void handleRegister();
      return;
    }

    void handleSubmit(e);
  };

  return (
    <IOSCompatibility>
      <main className='relative min-h-screen overflow-hidden bg-[rgb(var(--ui-bg))] text-[rgb(var(--ui-text))]'>
        <Image
          src='/login-cinema-bg.png'
          alt=''
          fill
          priority
          sizes='100vw'
          className='pointer-events-none object-cover object-center opacity-90'
        />
        <div className='pointer-events-none absolute inset-0 bg-[rgb(var(--ui-bg)/0.24)]' />

        <div className='absolute right-4 top-4 z-20 sm:right-6 sm:top-6'>
          <ThemeToggle />
        </div>

        <div className='relative z-10 mx-auto flex min-h-screen w-full max-w-[1660px] items-center px-4 py-20 sm:px-8 lg:w-[calc(77.5vw+80px)] lg:translate-y-7 lg:px-10'>
          <div className='grid w-full overflow-hidden rounded-[28px] border border-[rgb(var(--ui-border)/0.9)] bg-[rgb(var(--ui-bg)/0.78)] shadow-[0_36px_110px_rgb(0_0_0/0.52)] backdrop-blur-xl lg:h-[min(73vh,840px)] lg:grid-cols-[1.07fr_0.93fr]'>
            <section className='relative hidden h-full min-h-0 overflow-hidden border-r border-[rgb(var(--ui-border)/0.82)] lg:block'>
              <Image
                src='/login-cinema-bg.png'
                alt=''
                fill
                priority
                sizes='(min-width: 1024px) 52vw, 0px'
                className='object-cover object-left opacity-90'
              />
              <div className='absolute inset-0 bg-[rgb(var(--ui-bg)/0.2)]' />

              <div className='relative flex h-full flex-col items-center px-12 pb-16 pt-[168px] text-center'>
                <div className='mb-9 flex h-28 w-28 items-center justify-center rounded-[28px] border border-[rgb(var(--ui-border)/0.9)] bg-[rgb(var(--ui-bg)/0.62)] shadow-[0_18px_50px_rgb(0_0_0/0.38)] backdrop-blur-xl'>
                  <Image
                    src='/logo.png'
                    alt=''
                    width={72}
                    height={72}
                    priority
                    className='h-[72px] w-[72px] rounded-ui-md object-cover'
                  />
                </div>

                <h1 className='text-[64px] font-bold leading-none tracking-[-0.045em] text-[rgb(var(--ui-text))]'>
                  <span>Reel</span>
                  <span className='text-[#67e8f9]'>Find</span>
                </h1>
                <p className='mt-5 text-xl tracking-wide text-[rgb(var(--ui-text-muted))]'>
                  你的私人放映厅，随时续播。
                </p>

                <div className='mt-9 flex flex-wrap justify-center gap-3'>
                  {[
                    [Layers3, '聚合片源'],
                    [Clock3, '观看进度'],
                    [LockKeyhole, '私密访问'],
                  ].map(([Icon, label]) => (
                    <div
                      key={label as string}
                      className='inline-flex items-center gap-2.5 rounded-full border border-[rgb(var(--ui-border)/0.74)] bg-[rgb(var(--ui-bg)/0.42)] px-5 py-3 text-base text-[rgb(var(--ui-text-muted))] shadow-ui-soft backdrop-blur-md'
                    >
                      <Icon className='h-[18px] w-[18px] text-[rgb(var(--ui-accent))]' />
                      <span>{label as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section
              className={`flex min-h-[600px] items-start bg-[rgb(var(--ui-bg)/0.32)] px-5 pb-12 pt-12 sm:px-10 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:px-16 xl:px-20 ${
                authMode === 'register' ? 'lg:pt-8' : 'lg:pt-[74px]'
              }`}
            >
              <div className='mx-auto w-full max-w-[560px]'>
                <div className='mb-8 flex items-center gap-3 lg:hidden'>
                  <div className='flex h-12 w-12 items-center justify-center rounded-ui-md border border-[rgb(var(--ui-border)/0.8)] bg-[rgb(var(--ui-surface)/0.74)] shadow-ui-soft'>
                    <Image
                      src='/logo.png'
                      alt=''
                      width={40}
                      height={40}
                      priority
                      className='h-9 w-9 rounded-ui-sm object-cover'
                    />
                  </div>
                  <div>
                    <p className='text-lg font-semibold'>ReelFind</p>
                    <p className='mt-0.5 text-xs text-[rgb(var(--ui-text-muted))]'>
                      私人放映厅
                    </p>
                  </div>
                </div>

                <div className={authMode === 'register' ? 'mb-4' : 'mb-7'}>
                  <h2 className='text-[44px] font-semibold leading-tight tracking-tight text-[rgb(var(--ui-text))]'>
                    {authMode === 'register' ? '创建账号' : '欢迎回来'}
                  </h2>
                  <p className='mt-2.5 text-base leading-7 text-[rgb(var(--ui-text-muted))]'>
                    {authMode === 'register'
                      ? '完成验证，加入你的私人放映厅'
                      : '登录后继续你的观影旅程'}
                  </p>
                </div>

                {shouldAskUsername && enableRegister && (
                  <div className='mb-8 grid grid-cols-2 gap-1 rounded-ui-md border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg)/0.34)] p-1'>
                    {[
                      ['login', '登录'],
                      ['register', '注册'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type='button'
                        aria-pressed={authMode === mode}
                        onClick={() => {
                          setError(null);
                          setAuthMode(mode as AuthMode);
                        }}
                        className={`rounded-ui-sm px-4 py-3.5 text-base font-semibold transition-all duration-200 ${
                          authMode === mode
                            ? 'bg-[rgb(var(--ui-accent)/0.88)] text-[rgb(var(--ui-on-accent))] shadow-ui-soft'
                            : 'text-[rgb(var(--ui-text-muted))] hover:bg-[rgb(var(--ui-surface))] hover:text-[rgb(var(--ui-text))]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={handleAuthSubmit}
                  className={
                    authMode === 'register' ? 'space-y-4' : 'space-y-6'
                  }
                >
                  {shouldAskUsername && (
                    <div>
                      <label
                        htmlFor='username'
                        className='mb-2.5 block text-base font-medium text-[rgb(var(--ui-text-muted))]'
                      >
                        用户名
                      </label>
                      <div className='relative'>
                        <UserRound className='pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                        <input
                          id='username'
                          type='text'
                          autoComplete='username'
                          className='login-input block min-h-[60px] w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg)/0.34)] py-4 pl-16 pr-5 text-lg text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted)/0.72)] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.28)]'
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
                      className='mb-2.5 block text-base font-medium text-[rgb(var(--ui-text-muted))]'
                    >
                      访问密码
                    </label>
                    <div className='relative'>
                      <LockKeyhole className='pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                      <input
                        id='password'
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={
                          authMode === 'register'
                            ? 'new-password'
                            : 'current-password'
                        }
                        className='login-input block min-h-[60px] w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg)/0.34)] py-4 pl-16 pr-16 text-lg text-[rgb(var(--ui-text))] shadow-ui-soft selection:bg-[rgb(var(--ui-accent)/0.28)] selection:text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted)/0.72)] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.28)]'
                        placeholder='输入访问密码'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        className='absolute right-0 top-1/2 flex h-full w-16 -translate-y-1/2 items-center justify-center rounded-r-ui-sm text-[rgb(var(--ui-text-muted))] transition-colors duration-200 before:absolute before:inset-y-1 before:right-2 before:w-11 before:rounded-ui-sm before:border before:border-transparent before:bg-transparent before:transition-all before:duration-200 hover:text-[rgb(var(--ui-text))] hover:before:border-[rgb(var(--ui-border)/0.62)] hover:before:bg-[rgb(var(--ui-surface-strong)/0.44)] hover:before:shadow-ui-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ui-accent)/0.38)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--ui-bg))]'
                        onClick={() => setShowPassword((value) => !value)}
                        onMouseDown={(event) => event.preventDefault()}
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

                  {authMode === 'register' &&
                    shouldAskUsername &&
                    enableRegister && (
                      <>
                        {registerInviteRequired && (
                          <div>
                            <label
                              htmlFor='inviteCode'
                              className='mb-2.5 block text-base font-medium text-[rgb(var(--ui-text-muted))]'
                            >
                              邀请码
                            </label>
                            <div className='relative'>
                              <Hash className='pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]' />
                              <input
                                id='inviteCode'
                                type='text'
                                autoComplete='off'
                                className='login-input block min-h-[60px] w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.86)] bg-[rgb(var(--ui-bg)/0.34)] py-4 pl-16 pr-5 text-lg text-[rgb(var(--ui-text))] shadow-ui-soft placeholder:text-[rgb(var(--ui-text-muted)/0.72)] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.28)]'
                                placeholder='输入邀请码'
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value)}
                              />
                            </div>
                          </div>
                        )}

                        {turnstileSiteKey ? (
                          <div
                            id='register-turnstile'
                            className='flex min-h-[82px] items-center justify-center overflow-hidden rounded-ui-sm border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg)/0.34)] px-3 py-2'
                          />
                        ) : (
                          <p className='rounded-ui-sm border border-[rgb(var(--ui-critical)/0.36)] bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                            注册人机验证尚未配置，请稍后再试。
                          </p>
                        )}
                      </>
                    )}

                  {authMode === 'login' &&
                    loginTurnstileRequired &&
                    (turnstileSiteKey ? (
                      <div
                        id='login-turnstile'
                        className='flex min-h-[82px] items-center justify-center overflow-hidden rounded-ui-sm border border-[rgb(var(--ui-border)/0.72)] bg-[rgb(var(--ui-bg)/0.34)] px-3 py-2'
                      />
                    ) : (
                      <p className='rounded-ui-sm border border-[rgb(var(--ui-critical)/0.36)] bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                        登录人机验证尚未配置，请稍后再试。
                      </p>
                    ))}

                  {error && (
                    <p
                      role='alert'
                      className='rounded-ui-sm border border-[rgb(var(--ui-critical)/0.36)] bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-text))]'
                    >
                      {error}
                    </p>
                  )}

                  <button
                    type='submit'
                    disabled={
                      authMode === 'register'
                        ? !password ||
                          !username ||
                          loading ||
                          !turnstileSiteKey ||
                          !turnstileToken ||
                          (registerInviteRequired && !inviteCode.trim())
                        : !password ||
                          loading ||
                          (shouldAskUsername && !username) ||
                          (loginTurnstileRequired &&
                            (!turnstileSiteKey || !turnstileToken))
                    }
                    className='inline-flex min-h-[60px] w-full items-center justify-center rounded-ui-sm bg-[rgb(var(--ui-accent))] px-5 py-4 text-lg font-semibold text-[rgb(var(--ui-on-accent))] shadow-[0_14px_32px_rgb(var(--ui-accent)/0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0'
                  >
                    {loading ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {authMode === 'register' ? '注册中...' : '登录中...'}
                      </>
                    ) : (
                      <>
                        {authMode === 'register'
                          ? '创建 ReelFind 账号'
                          : '进入 ReelFind'}
                      </>
                    )}
                  </button>
                </form>

                <div
                  className={`flex items-center justify-center gap-2.5 text-sm text-[rgb(var(--ui-text-muted))] ${
                    authMode === 'register' ? 'mt-4' : 'mt-8'
                  }`}
                >
                  <ShieldCheck className='h-5 w-5 text-[rgb(var(--ui-success))]' />
                  <span>凭证仅用于安全访问</span>
                </div>
              </div>
            </section>
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
