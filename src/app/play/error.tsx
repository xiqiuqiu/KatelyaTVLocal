'use client';

import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import PageLayout from '@/components/PageLayout';
import Surface from '@/components/ui/Surface';

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('播放页渲染异常:', error);
  }, [error]);

  return (
    <PageLayout activePath='/play'>
      <div className='flex min-h-[70vh] items-center justify-center px-3'>
        <Surface
          variant='frosted'
          className='ui-loading-panel mx-auto w-full max-w-xl px-6 py-8 text-center sm:px-8 sm:py-10'
        >
          <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[rgba(var(--ui-critical),0.24)] bg-[rgba(var(--ui-critical),0.12)] text-[rgb(var(--ui-critical))] shadow-ui-soft'>
            <AlertCircle className='h-10 w-10' strokeWidth={1.6} />
          </div>

          <div className='mt-6 space-y-3'>
            <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--ui-accent-warm))]'>
              页面渲染异常
            </p>
            <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
              播放页加载失败
            </h2>
            <p className='mx-auto max-w-md text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
              播放页在渲染时遇到问题，可以尝试重新加载页面。
            </p>
          </div>

          {error.message ? (
            <div className='mt-7 rounded-ui-md border border-[rgba(var(--ui-critical),0.22)] bg-[rgba(var(--ui-critical),0.08)] px-4 py-3 text-sm font-medium text-[rgb(var(--ui-text))]'>
              {error.message}
            </div>
          ) : null}

          <div className='mt-8 grid gap-3 sm:grid-cols-2'>
            <button
              type='button'
              onClick={() => reset()}
              className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-md bg-[rgb(var(--ui-accent))] px-4 text-sm font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition hover:brightness-110'
            >
              <RefreshCw className='h-4 w-4' />
              重试
            </button>

            <button
              type='button'
              onClick={() => router.back()}
              className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-md border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
            >
              <ArrowLeft className='h-4 w-4' />
              返回上页
            </button>
          </div>
        </Surface>
      </div>
    </PageLayout>
  );
}
