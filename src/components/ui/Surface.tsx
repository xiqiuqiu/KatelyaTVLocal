import type { ElementType, ReactNode } from 'react';

interface SurfaceProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  variant?: 'plain' | 'raised' | 'frosted';
}

const variantClassNames: Record<NonNullable<SurfaceProps['variant']>, string> =
  {
    plain: 'ui-glass-subtle shadow-none',
    raised: 'ui-glass transition duration-300 hover:-translate-y-1 hover:border-[rgb(var(--ui-accent)/0.34)] hover:shadow-ui-strong',
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
