'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = theme === 'dark' ? '#0c111c' : '#f9fbfe';
      document.head.appendChild(meta);
    } else {
      const newContent = theme === 'dark' ? '#0c111c' : '#f9fbfe';
      meta.setAttribute('content', newContent);
    }
  };

  useEffect(() => {
    setMounted(true);
    setThemeColor(resolvedTheme);
  }, [resolvedTheme]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='w-11 h-11' />;
  }

  const toggleTheme = () => {
    // 检查当前主题，如果 resolvedTheme 为 undefined，默认切换到 dark
    const currentTheme = resolvedTheme || 'light';
    const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';

    setThemeColor(targetTheme);

    // 使用更好的类型定义
    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };

    if (!documentWithTransition.startViewTransition) {
      setTheme(targetTheme);
      return;
    }

    documentWithTransition.startViewTransition(() => {
      setTheme(targetTheme);
    });
  };

  return (
    <button
      onClick={toggleTheme}
      className='flex h-11 w-11 items-center justify-center rounded-ui-sm border border-white/10 bg-white/5 p-2 text-[rgb(var(--ui-text-muted))] shadow-ui-soft transition-colors hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
      aria-label='Toggle theme'
    >
      {(resolvedTheme || 'light') === 'dark' ? (
        <Sun className='w-full h-full' />
      ) : (
        <Moon className='w-full h-full' />
      )}
    </button>
  );
}
