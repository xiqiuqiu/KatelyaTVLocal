'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { LoadingRing } from '@/components/ui/LoadingPrimitives';

interface InitialLoadingOverlayProps {
  title?: string;
}

export default function InitialLoadingOverlay({
  title,
}: InitialLoadingOverlayProps) {
  const router = useRouter();
  return (
    <div
      aria-label={title ? `正在准备播放 ${title}` : '正在准备播放'}
      className='ui-play-loading space-y-6'
      role='status'
    >
      <div className='ui-play-loading-header flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold text-[rgb(var(--ui-text))] md:text-3xl'>
            {title || '准备播放'}
          </h1>
          <div
            aria-hidden
            className='mt-2 h-5 w-40 rounded bg-[rgb(var(--ui-surface-strong))]'
          />
        </div>
        <button
          className='ui-secondary-button'
          onClick={() => router.back()}
          type='button'
        >
          <ArrowLeft aria-hidden className='h-4 w-4' />
          返回上一页
        </button>
      </div>
      <div className='ui-initial-player-layout grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]'>
        <div
          data-playback-preparation-target
          className='relative aspect-video w-full rounded-ui-md bg-black text-white'
        >
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center'>
            <LoadingRing className='h-8 w-8' />
            <p className='text-base'>正在准备播放</p>
            <p className='text-sm text-white/70'>正在获取播放资源，请稍候</p>
          </div>
        </div>
        <div
          aria-hidden
          className='ui-initial-player-sidebar space-y-4 rounded-ui-md bg-[rgb(var(--ui-surface))] p-5'
        >
          <div className='h-6 w-28 rounded bg-[rgb(var(--ui-surface-strong))]' />
          <div className='h-11 rounded bg-[rgb(var(--ui-surface-strong))]' />
          <div className='h-20 rounded bg-[rgb(var(--ui-surface-strong))]' />
        </div>
      </div>
    </div>
  );
}
