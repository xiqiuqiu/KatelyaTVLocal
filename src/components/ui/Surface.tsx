import type { ElementType, ReactNode } from 'react';

interface SurfaceProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  variant?: 'plain' | 'raised' | 'frosted';
}

const variantClassNames: Record<
  NonNullable<SurfaceProps['variant']>,
  string
> = {
  plain: 'ui-glass-subtle',
  raised: 'ui-glass',
  frosted: 'ui-glass-strong',
};

export default function Surface({
  as: Component = 'div',
  children,
  className = '',
  variant = 'raised',
}: SurfaceProps) {
  return (
    <Component
      className={`rounded-ui-md ${variantClassNames[variant]} ${className}`.trim()}
    >
      {children}
    </Component>
  );
}
