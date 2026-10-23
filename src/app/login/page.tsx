'use client';

export const runtime = 'edge';

import {
  Eye,
  EyeOff,
  Hash,
  Loader2,
  LockKeyhole,
  Tv,
  UserRound,
} from 'lucide-react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { getInviteCodeFromSearchParams } from '@/lib/registration/invite-link';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { buildTvModeHref, isTvMode } from '@/lib/tv-interaction';

import IOSCompatibility from '@/components/IOSCompatibility';
import { ThemeToggle } from '@/components/ThemeToggle';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

type AuthMode = 'login' | 'register';
const REMEMBER_LOGIN_KEY = 'katelya.rememberLogin';
const REMEMBER_USERNAME_KEY = 'katelya.rememberedUsername';

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
  const tvMode = isTvMode(searchParams);
  const rootRef = useRef<HTMLDivElement>(null);
  useTvBrowseNavigation(rootRef, tvMode, '/login', true);
  const modeHref = buildTvModeHref(
    `/login?${searchParams.toString()}`,
    !tvMode
  );
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [loginTurnstileRequired, setLoginTurnstileRequired] = useState(false);
  const [registerInviteRequired, setRegisterInviteRequired] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    getInviteCodeFromSearchParams(searchParams) ? 'register' : 'login'
  );
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
    if (authMode !== 'login') return;
    try {
      const remembered = localStorage.getItem(REMEMBER_LOGIN_KEY) === 'true';
      setRememberMe(remembered);
      if (remembered)
        setUsername(localStorage.getItem(REMEMBER_USERNAME_KEY) || '');
    } catch {
      // Login remains available when device storage is blocked.
    }
  }, [authMode]);

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
          rememberMe,
        }),
      });

      if (res.ok) {
        try {
          if (rememberMe) {
            localStorage.setItem(REMEMBER_LOGIN_KEY, 'true');
            if (shouldAskUsername)
              localStorage.setItem(REMEMBER_USERNAME_KEY, username);
            else localStorage.removeItem(REMEMBER_USERNAME_KEY);
          } else {
            localStorage.removeItem(REMEMBER_LOGIN_KEY);
            localStorage.removeItem(REMEMBER_USERNAME_KEY);
          }
        } catch {
          // A successful server session does not depend on local preferences.
        }
        window.location.href = getSafeRedirectPath(
          searchParams.get('redirect'),
          '/'
        );
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
        window.location.href = getSafeRedirectPath(
          searchParams.get('redirect'),
          '/'
        );
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
      <div
        ref={rootRef}
        data-tv-mode={tvMode}
        data-tv-browse={tvMode}
        className='ui-auth-page min-h-dvh bg-[rgb(var(--ui-bg))] px-4 pb-8 pt-4 text-[rgb(var(--ui-text))] sm:px-8'
      >
        <header className='ui-auth-toolbar mx-auto flex w-full max-w-[1080px] items-center justify-between gap-4'>
          <span className='text-lg font-semibold'>KatelyaTV</span>
          <div className='flex items-center gap-2'>
            <a
              href={modeHref}
              className='ui-secondary-button'
              data-tv-focus-key='auth-mode-switch'
            >
              <Tv aria-hidden className='h-5 w-5 shrink-0' />
              {tvMode ? '退出电视模式' : '电视模式'}
            </a>
            <ThemeToggle />
          </div>
        </header>

        <main className='ui-auth-layout mx-auto mt-8 grid w-full max-w-[1080px] overflow-hidden rounded-ui-lg border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] lg:mt-12 lg:grid-cols-[0.9fr_1.1fr]'>
          <section className='ui-auth-story relative hidden min-w-0 flex-col justify-between border-r border-[rgb(var(--ui-border))] p-10 lg:flex'>
            <div>
              <Image
                src='/logo.png'
                alt=''
                width={56}
                height={56}
                className='h-14 w-14 rounded-ui-md object-cover'
              />
              <h2 className='ui-auth-story-title mt-8 font-semibold'>
                你的私人放映厅
              </h2>
              <p className='mt-4 text-base leading-7 text-[rgb(var(--ui-text-muted))]'>
                找一部想看的，接着上次的进度。
              </p>
            </div>
            <div className='relative mt-10 aspect-[4/3] overflow-hidden rounded-ui-md'>
              <Image
                src='/login-cinema-bg.png'
                alt=''
                fill
                sizes='(min-width: 1024px) 400px, 0px'
                className='object-cover object-left'
              />
            </div>
          </section>

          <section className='ui-auth-form-panel min-w-0 px-5 py-8 sm:px-10 lg:p-12'>
            <div className='ui-auth-form mx-auto w-full max-w-[460px]'>
              <div className='ui-auth-form-heading'>
                <h1 className='ui-auth-title font-semibold'>
                  {authMode === 'register' ? '创建账号' : '欢迎回来'}
                </h1>
                <p className='ui-auth-hint mt-3 text-base leading-6 text-[rgb(var(--ui-text-muted))]'>
                  {authMode === 'register'
                    ? '完成验证，加入你的私人放映厅'
                    : '登录后继续你的观影旅程'}
                </p>
              </div>

              {shouldAskUsername && enableRegister && (
                <div className='ui-auth-tabs mb-6 grid grid-cols-2 gap-2'>
                  {[
                    ['login', '登录'],
                    ['register', '注册'],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type='button'
                      aria-pressed={authMode === mode}
                      data-tv-focus-key={`auth-tab-${mode}`}
                      onClick={() => {
                        setError(null);
                        setAuthMode(mode as AuthMode);
                      }}
                      className={`ui-auth-tab ${
                        authMode === mode
                          ? 'ui-primary-button'
                          : 'ui-secondary-button'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {tvMode && (
                <p
                  id='auth-tv-input-hint'
                  className='ui-auth-hint mb-6 text-sm leading-6 text-[rgb(var(--ui-text-muted))]'
                >
                  方向键选择输入框，确认键开始输入；输入后按确认或返回键继续选择。
                </p>
              )}

              <form
                onSubmit={handleAuthSubmit}
                aria-busy={loading}
                autoComplete='on'
                className='space-y-5'
              >
                {shouldAskUsername && (
                  <div>
                    <label
                      htmlFor='username'
                      className='ui-auth-label mb-2 block text-base font-medium'
                    >
                      用户名
                    </label>
                    <div className='ui-auth-input-wrap relative'>
                      <UserRound
                        aria-hidden
                        className='ui-auth-input-icon pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]'
                      />
                      <input
                        id='username'
                        name='username'
                        type='text'
                        autoComplete='username'
                        data-tv-primary
                        data-tv-focus-key='auth-username'
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error
                            ? 'auth-error'
                            : tvMode
                            ? 'auth-tv-input-hint'
                            : undefined
                        }
                        className='ui-auth-input ui-input block w-full !pl-12'
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
                    className='ui-auth-label mb-2 block text-base font-medium'
                  >
                    访问密码
                  </label>
                  <div className='ui-auth-input-wrap relative'>
                    <LockKeyhole
                      aria-hidden
                      className='ui-auth-input-icon pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]'
                    />
                    <input
                      id='password'
                      name='password'
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        authMode === 'register'
                          ? 'new-password'
                          : 'current-password'
                      }
                      data-tv-primary={!shouldAskUsername || undefined}
                      data-tv-focus-key='auth-password'
                      aria-invalid={Boolean(error)}
                      aria-describedby={
                        error
                          ? 'auth-error'
                          : tvMode
                          ? 'auth-tv-input-hint'
                          : undefined
                      }
                      className='ui-auth-input ui-input block w-full !pl-12 !pr-14'
                      placeholder='输入访问密码'
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      aria-pressed={showPassword}
                      data-tv-focus-key='auth-password-visibility'
                      className='ui-auth-password-toggle absolute right-0 top-0 flex h-full min-h-11 w-12 items-center justify-center rounded-r-ui-sm text-[rgb(var(--ui-text-muted))] hover:bg-[rgb(var(--ui-surface-strong))] hover:text-[rgb(var(--ui-text))]'
                      onClick={() => setShowPassword((value) => !value)}
                      onMouseDown={(event) => event.preventDefault()}
                      type='button'
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden className='h-5 w-5' />
                      ) : (
                        <Eye aria-hidden className='h-5 w-5' />
                      )}
                    </button>
                  </div>
                </div>

                {authMode === 'login' && (
                  <label className='ui-auth-label flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[rgb(var(--ui-text-muted))]'>
                    <input
                      name='rememberMe'
                      type='checkbox'
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className='h-5 w-5 shrink-0 accent-[rgb(var(--ui-accent))]'
                      data-tv-focus-key='auth-remember-login'
                    />
                    在此设备保持登录 30 天
                  </label>
                )}

                {authMode === 'register' &&
                  shouldAskUsername &&
                  enableRegister && (
                    <>
                      {registerInviteRequired && (
                        <div>
                          <label
                            htmlFor='inviteCode'
                            className='ui-auth-label mb-2 block text-base font-medium'
                          >
                            邀请码
                          </label>
                          <div className='ui-auth-input-wrap relative'>
                            <Hash
                              aria-hidden
                              className='ui-auth-input-icon pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--ui-text-muted))]'
                            />
                            <input
                              id='inviteCode'
                              type='text'
                              autoComplete='off'
                              data-tv-focus-key='auth-invite'
                              aria-invalid={Boolean(error)}
                              aria-describedby={
                                error
                                  ? 'auth-error'
                                  : tvMode
                                  ? 'auth-tv-input-hint'
                                  : undefined
                              }
                              className='ui-auth-input ui-input block w-full !pl-12'
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
                          className='ui-auth-status flex min-h-[82px] items-center justify-center overflow-x-auto rounded-ui-sm bg-[rgb(var(--ui-bg))] py-2'
                        />
                      ) : (
                        <p className='ui-auth-status rounded-ui-sm bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-critical))]'>
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
                      className='ui-auth-status flex min-h-[82px] items-center justify-center overflow-x-auto rounded-ui-sm bg-[rgb(var(--ui-bg))] py-2'
                    />
                  ) : (
                    <p className='ui-auth-status rounded-ui-sm bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-critical))]'>
                      登录人机验证尚未配置，请稍后再试。
                    </p>
                  ))}

                {error && (
                  <p
                    id='auth-error'
                    role='alert'
                    className='ui-auth-status rounded-ui-sm bg-[rgb(var(--ui-critical)/0.12)] px-4 py-3 text-sm text-[rgb(var(--ui-critical))]'
                  >
                    {error}
                  </p>
                )}

                <button
                  type='submit'
                  data-tv-focus-key='auth-submit'
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
                  className='ui-auth-submit ui-primary-button w-full'
                >
                  {loading ? (
                    <>
                      <Loader2 aria-hidden className='h-5 w-5 animate-spin' />
                      {authMode === 'register' ? '注册中...' : '登录中...'}
                    </>
                  ) : authMode === 'register' ? (
                    '创建 KatelyaTV 账号'
                  ) : (
                    '进入 KatelyaTV'
                  )}
                </button>
              </form>
            </div>
          </section>
        </main>
      </div>
    </IOSCompatibility>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-dvh items-center justify-center bg-[rgb(var(--ui-bg))] text-[rgb(var(--ui-text-muted))]'>
          正在加载登录页面…
        </div>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
