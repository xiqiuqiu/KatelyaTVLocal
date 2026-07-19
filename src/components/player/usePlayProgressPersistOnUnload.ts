'use client';

import { useEffect } from 'react';

import type { PlayRecordSaveReason } from '@/lib/play-record-save-policy';

type SaveProgressFn = (
  reason: PlayRecordSaveReason,
  options?: {
    keepalive?: boolean;
  }
) => Promise<void>;

export function usePlayProgressPersistOnUnload(
  requestSaveCurrentPlayProgressRef: React.MutableRefObject<SaveProgressFn>
) {
  useEffect(() => {
    const handleBeforeUnload = () => {
      void requestSaveCurrentPlayProgressRef.current('beforeunload', {
        keepalive: true,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void requestSaveCurrentPlayProgressRef.current('visibility-hidden', {
          keepalive: true,
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestSaveCurrentPlayProgressRef]);
}
