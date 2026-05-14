import { SkeletonBlock } from '@/components/ui/LoadingPrimitives';

const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <SkeletonBlock className={`w-full ${aspectRatio} rounded-ui-md`} />
);

export { ImagePlaceholder };
