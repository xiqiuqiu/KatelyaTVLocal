import { LoadingRing } from '@/components/ui/LoadingPrimitives';

interface PlayerLoadingOverlayProps {
  stage: 'initing' | 'sourceChanging';
}

export default function PlayerLoadingOverlay({
  stage,
}: PlayerLoadingOverlayProps) {
  const title = stage === 'sourceChanging' ? '切换播放源中' : '正在加载视频';

  return (
    <div
      role='status'
      className='absolute inset-0 z-[500] flex items-center justify-center rounded-ui-md bg-[rgba(var(--ui-bg),0.78)] px-4'
    >
      <div className='w-full max-w-sm rounded-ui-md bg-[rgb(var(--ui-surface))] px-6 py-5 text-center'>
        <div className='mx-auto flex h-16 w-16 items-center justify-center rounded-ui-md bg-[rgb(var(--ui-surface-strong))]'>
          <LoadingRing className='h-9 w-9' />
        </div>

        <div className='mt-4 space-y-1.5'>
          <p className='text-lg font-semibold text-[rgb(var(--ui-text))]'>
            {title}
          </p>
          <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
            正在连接当前线路并同步播放器状态
          </p>
        </div>
      </div>
    </div>
  );
}
