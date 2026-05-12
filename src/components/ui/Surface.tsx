import type { ElementType, ReactNode } from 'react';

interface SurfaceProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  variant?: 'plain' | 'raised' | 'frosted';
}

const variantClassNames: Record<NonNullable<SurfaceProps['variant']>, string> =
  {
    plain:
      'border border-white/10 bg-[rgba(var(--ui-surface),0.44)] shadow-none',
    raised:
      'border border-white/10 bg-[rgba(var(--ui-surface-strong),0.84)] shadow-ui-soft',
    frosted: 'ui-shell-panel',
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
