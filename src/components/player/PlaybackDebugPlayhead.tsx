'use client';

import type { MutableRefObject } from 'react';
import { useEffect, useState } from 'react';

export function formatDebugPlaybackTime(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--:--';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function PlaybackDebugPlayhead({
  currentTimeRef,
}: {
  currentTimeRef: MutableRefObject<number>;
}) {
  const [displayTime, setDisplayTime] = useState(currentTimeRef.current);

  useEffect(() => {
    setDisplayTime(currentTimeRef.current);
    const intervalId = window.setInterval(() => {
      setDisplayTime(currentTimeRef.current);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimeRef]);

  return <>位置：{formatDebugPlaybackTime(displayTime)}</>;
}
