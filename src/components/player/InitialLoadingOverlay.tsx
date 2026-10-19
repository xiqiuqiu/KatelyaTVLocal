import { LoadingRing } from '@/components/ui/LoadingPrimitives';
import Surface from '@/components/ui/Surface';

interface InitialLoadingOverlayProps {
  title?: string;
}

export default function InitialLoadingOverlay({
  title,
}: InitialLoadingOverlayProps) {
  return (
    <div
      aria-label={title ? `正在准备播放 ${title}` : '正在准备播放'}
      className='flex min-h-[70vh] items-center justify-center'
      role='status'
    >
      <Surface
        variant='plain'
        className='ui-loading-panel mx-auto w-full max-w-md px-6 py-9 text-center sm:px-8 sm:py-11'
      >
        <div className='mx-auto flex h-16 w-16 items-center justify-center rounded-ui-md bg-[rgb(var(--ui-surface-strong))]'>
          <LoadingRing className='h-9 w-9' />
        </div>
        {title ? (
          <h2 className='mt-6 text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
            {title}
          </h2>
        ) : null}
        <p className='mt-3 text-sm text-[rgb(var(--ui-text-muted))]'>
          正在准备播放
        </p>
      </Surface>
    </div>
  );
}
