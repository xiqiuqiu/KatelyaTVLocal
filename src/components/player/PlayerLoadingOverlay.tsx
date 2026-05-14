import { LoadingRing } from '@/components/ui/LoadingPrimitives';

interface PlayerLoadingOverlayProps {
  stage: 'initing' | 'sourceChanging';
}

export default function PlayerLoadingOverlay({
  stage,
}: PlayerLoadingOverlayProps) {
  const title = stage === 'sourceChanging' ? '切换播放源中' : '正在加载视频';

  return (
    <div className='absolute inset-0 z-[500] flex items-center justify-center rounded-ui-md bg-[rgba(var(--ui-bg),0.78)] px-4 backdrop-blur-md transition-all duration-300'>
      <div className='w-full max-w-sm rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.86)] px-6 py-5 text-center shadow-ui-strong'>
        <div className='mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-[rgba(var(--ui-surface-strong),0.88)]'>
          <LoadingRing className='h-9 w-9' />
        </div>

        <div className='mt-4 space-y-1.5'>
          <p className='text-lg font-semibold text-white'>{title}</p>
          <p className='text-sm text-white/60'>正在连接当前线路并同步播放器状态</p>
        </div>
      </div>
    </div>
  );
}