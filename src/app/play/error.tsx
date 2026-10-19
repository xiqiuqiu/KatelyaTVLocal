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
    // eslint-disable-next-line no-console
    console.error('播放页渲染异常:', error);
  }, [error]);

  return (
    <PageLayout activePath='/play'>
      <div className='flex min-h-[70vh] items-center justify-center px-3'>
        <Surface
          variant='plain'
          className='ui-loading-panel mx-auto w-full max-w-xl px-6 py-8 text-center sm:px-8 sm:py-10'
        >
          <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-ui-md bg-[rgba(var(--ui-critical),0.12)] text-[rgb(var(--ui-critical))]'>
            <AlertCircle className='h-10 w-10' strokeWidth={1.6} />
          </div>

          <div className='mt-6 space-y-3'>
            <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
              播放页加载失败
            </h2>
            <p className='mx-auto max-w-md text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
              播放页在渲染时遇到问题，可以尝试重新加载页面。
            </p>
          </div>

          {error.message ? (
            <div className='mt-7 rounded-ui-md border border-[rgba(var(--ui-critical),0.22)] bg-[rgba(var(--ui-critical),0.08)] px-4 py-3 text-sm font-medium text-[rgb(var(--ui-text))]'>
              <p className='font-semibold text-[rgb(var(--ui-critical))]'>
                页面渲染异常
              </p>
              <p className='mt-1'>{error.message}</p>
            </div>
          ) : null}

          <div className='mt-8 grid gap-3 sm:grid-cols-2'>
            <button
              type='button'
              onClick={() => reset()}
              className='ui-primary-button'
            >
              <RefreshCw className='h-4 w-4' />
              重试
            </button>

            <button
              type='button'
              onClick={() => router.back()}
              className='ui-secondary-button'
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
