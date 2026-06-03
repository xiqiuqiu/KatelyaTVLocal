'use client';

import { useEffect, useState } from 'react';

interface IOSCompatibilityProps {
  children: React.ReactNode;
}

export function IOSCompatibility({ children }: IOSCompatibilityProps) {
  const [isIOSWebKit, setIsIOSWebKit] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const iPadDesktopMode =
      navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const iOSWebKit = iOSDevice || iPadDesktopMode;

    setIsIOSWebKit(iOSWebKit);

    if (iOSWebKit) {
      document.documentElement.classList.add('ios-safari');
      document.body.classList.add('ios-safari');
    }

    // 清理函数
    return () => {
      document.documentElement.classList.remove('ios-safari');
      document.body.classList.remove('ios-safari');
    };
  }, []);

  useEffect(() => {
    if (isIOSWebKit) {
      const style = document.createElement('style');
      style.textContent = `
        .ios-safari .animate-pulse {
          animation: none !important;
        }
        
        .ios-safari .particle {
          animation: none !important;
          opacity: 0.4 !important;
        }
        
        .ios-safari .shape {
          animation: none !important;
          opacity: 0.2 !important;
        }
        
        .ios-safari .logo-background-glow {
          animation: none !important;
        }
        
        .ios-safari .main-katelya-logo {
          animation: none !important;
        }
        
        .ios-safari .katelya-logo {
          animation: none !important;
        }
        
        .ios-safari .bottom-logo {
          animation: none !important;
        }
        
        .ios-safari .backdrop-blur-xl {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        
        .ios-safari .bg-white\\/90 {
          background-color: rgba(255, 255, 255, 0.95) !important;
        }
        
        .ios-safari .dark .bg-zinc-900\\/90 {
          background-color: rgba(24, 24, 27, 0.95) !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        style.remove();
      };
    }
  }, [isIOSWebKit]);

  return <>{children}</>;
}

export default IOSCompatibility;
