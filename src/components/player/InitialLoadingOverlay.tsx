import { LoadingRing } from '@/components/ui/LoadingPrimitives';
import Surface from '@/components/ui/Surface';

type InitialLoadingStage = 'searching' | 'preferring' | 'fetching' | 'ready';

interface InitialLoadingOverlayProps {
  message: string;
  stage: InitialLoadingStage;
}

const stageLabels: Record<InitialLoadingStage, string> = {
  searching: '搜索片源',
  preferring: '优选线路',
  fetching: '获取详情',
  ready: '准备播放',
};

const stageOrder: InitialLoadingStage[] = [
  'searching',
  'preferring',
  'fetching',
  'ready',
];

const progressMap: Record<InitialLoadingStage, number> = {
  searching: 24,
  preferring: 52,
  fetching: 78,
  ready: 100,
};

export default function InitialLoadingOverlay({
  message,
  stage,
}: InitialLoadingOverlayProps) {
  const activeIndex = stageOrder.indexOf(stage);

  return (
    <div className='flex min-h-[70vh] items-center justify-center'>
      <Surface
        variant='frosted'
        className='ui-loading-panel mx-auto w-full max-w-xl px-6 py-8 text-center sm:px-8 sm:py-10'
      >
        <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-[rgba(var(--ui-surface-strong),0.82)] shadow-ui-soft'>
          <LoadingRing className='h-11 w-11' />
        </div>

        <div className='mt-6 space-y-3'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--ui-accent-warm))]'>
            播放准备中
          </p>
          <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
            {message}
          </h2>
          <p className='mx-auto max-w-md text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
            正在检查可用线路并初始化播放环境，请稍候片刻。
          </p>
        </div>

        <div className='mt-8 space-y-4'>
          <div className='grid grid-cols-2 gap-2 text-left sm:grid-cols-4'>
            {stageOrder.map((item, index) => {
              const isActive = index <= activeIndex;
              const isCurrent = item === stage;

              return (
                <div
                  key={item}
                  className={`rounded-ui-sm border px-3 py-2 transition-[border-color,background-color,color,box-shadow] duration-300 ${
                    isActive
                      ? 'border-[rgba(var(--ui-accent),0.42)] bg-[rgba(var(--ui-accent),0.14)] text-[rgb(var(--ui-text))]'
                      : 'border-white/10 bg-white/5 text-[rgb(var(--ui-text-muted))]'
                  } ${isCurrent ? 'shadow-[0_0_0_1px_rgba(var(--ui-accent),0.18)]' : ''}`.trim()}
                >
                  <p className='text-[11px] uppercase tracking-[0.2em] opacity-70'>
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <p className='mt-1 text-sm font-medium'>{stageLabels[item]}</p>
                </div>
              );
            })}
          </div>

          <div className='h-2 overflow-hidden rounded-full bg-white/5'>
            <div
              className='h-full w-full origin-left rounded-full bg-[linear-gradient(90deg,rgba(var(--ui-accent),0.72),rgba(var(--ui-accent-warm),0.92))] transition-transform duration-200 ease-out'
              style={{
                transform: `scaleX(${Math.min(Math.max(progressMap[stage], 0), 100) / 100})`,
              }}
            ></div>
          </div>
        </div>
      </Surface>
    </div>
  );
}
