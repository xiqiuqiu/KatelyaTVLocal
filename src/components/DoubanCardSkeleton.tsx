import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';

interface DoubanCardSkeletonProps {
  index?: number;
}

const DoubanCardSkeleton = ({ index = 0 }: DoubanCardSkeletonProps) => {
  return (
    <SkeletonPosterCard
      className='w-full'
      delayIndex={index}
      lines={2}
      widths={['76%', '52%']}
    />
  );
};

export default DoubanCardSkeleton;
