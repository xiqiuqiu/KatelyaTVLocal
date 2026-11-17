'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import Switch from '@/components/ui/Switch';

/**
 * 深色外观开关：与顶栏 ThemeToggle 共用 next-themes，
 * 切换时尽量走 View Transition，保持与图标按钮一致的手感。
 */
export default function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : true;

  const handleChange = (next: boolean) => {
    const target = next ? 'dark' : 'light';
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    const canAnimate =
      typeof doc.startViewTransition === 'function' &&
      document.visibilityState === 'visible' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!canAnimate) {
      setTheme(target);
      return;
    }

    try {
      doc.startViewTransition?.(() => setTheme(target));
    } catch {
      setTheme(target);
    }
  };

  return (
    <Switch checked={isDark} label='深色外观' onCheckedChange={handleChange} />
  );
}
