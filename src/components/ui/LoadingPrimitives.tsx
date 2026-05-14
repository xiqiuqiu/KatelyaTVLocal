import type { CSSProperties, ElementType, ReactNode } from 'react';

type SkeletonWidth = number | string;

interface SkeletonBlockProps {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface SkeletonTextProps {
  className?: string;
  lineClassName?: string;
  lines?: number;
  widths?: SkeletonWidth[];
}

interface SkeletonPosterCardProps {
  aspectRatio?: string;
  className?: string;
  delayIndex?: number;
  lineClassName?: string;
  lines?: number;
  widths?: SkeletonWidth[];
}

interface LoadingRingProps {
  className?: string;
}

const resolveWidth = (width: SkeletonWidth | undefined, index: number) => {
  if (typeof width === 'number') {
    return `${width}%`;
  }

  if (typeof width === 'string') {
    return width;
  }

  return index === 0 ? '82%' : '56%';
};

export function SkeletonBlock({
  as: Component = 'div',
  children,
  className = '',
  style,
}: SkeletonBlockProps) {
  return (
    <Component
      aria-hidden='true'
      className={`ui-skeleton-block ${className}`.trim()}
      style={style}
    >
      {children}
    </Component>
  );
}

export function SkeletonText({
  className = '',
  lineClassName = '',
  lines = 2,
  widths = [],
}: SkeletonTextProps) {
  return (
    <div aria-hidden='true' className={`space-y-2 ${className}`.trim()}>
      {Array.from({ length: lines }).map((_, index) => {
        const style: CSSProperties = {
          width: resolveWidth(widths[index], index),
        };

        return (
          <SkeletonBlock
            key={`skeleton-line-${index}`}
            className={`h-3.5 rounded-full ${lineClassName}`.trim()}
            style={style}
          />
        );
      })}
    </div>
  );
}

export function SkeletonPosterCard({
  aspectRatio = 'aspect-[2/3]',
  className = '',
  delayIndex = 0,
  lineClassName = '',
  lines = 2,
  widths = [],
}: SkeletonPosterCardProps) {
  const baseDelay = delayIndex * 0.08;
  const styleInfo = { '--shimmer-delay': `${baseDelay}s` } as CSSProperties;

  return (
    <div className={className} style={styleInfo}>
      <SkeletonBlock className={`w-full ${aspectRatio} rounded-ui-md`} />
      <SkeletonText
        className='mt-3 px-1'
        lineClassName={lineClassName}
        lines={lines}
        widths={widths}
      />
    </div>
  );
}

export function LoadingRing({ className = '' }: LoadingRingProps) {
  return <div aria-hidden='true' className={`ui-loading-ring ${className}`.trim()} />;
}
