'use client';

import { useEffect, useState } from 'react';

/**
 * 响应式媒体查询：SSR 与不支持 matchMedia 的环境（如 jsdom 测试）返回 false，
 * 由调用方决定默认渲染哪一套布局。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
