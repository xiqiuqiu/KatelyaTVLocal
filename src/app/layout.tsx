import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';

import './globals.css';
import '@/styles/globals.css';
import '@/styles/ui-theme.css';
import 'sweetalert2/dist/sweetalert2.min.css';

import { getSessionSigningSecret } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { parseSessionCookieValue } from '@/lib/security/session';

import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });
const defaultImageProxy = '/api/image-proxy?url=';
const defaultSourceProbe = '/api/source-probe?url=';
const defaultHlsProxy = '/api/hls-proxy?url=';

export async function generateMetadata(): Promise<Metadata> {
  let siteName = process.env.SITE_NAME || 'KatelyaTV';
  if (
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'd1' &&
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'upstash'
  ) {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

const FloatingShapes = () => {
  return (
    <div className='floating-shapes'>
      <div className='shape'></div>
      <div className='shape'></div>
      <div className='shape'></div>
      <div className='shape'></div>
    </div>
  );
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = process.env.SITE_NAME || 'KatelyaTV';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。Link Me TG：@katelya77';
  let enableRegister = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
  let imageProxy = process.env.NEXT_PUBLIC_IMAGE_PROXY || '';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  const sourceProbe =
    process.env.NEXT_PUBLIC_SOURCE_PROBE || defaultSourceProbe;
  const hlsProxy = process.env.NEXT_PUBLIC_HLS_PROXY || defaultHlsProxy;
  if (
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'd1' &&
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'upstash'
  ) {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;
    enableRegister = config.UserConfig.AllowRegister;
    imageProxy = config.SiteConfig.ImageProxy;
    doubanProxy = config.SiteConfig.DoubanProxy;
  }

  if (!imageProxy.trim()) {
    imageProxy = defaultImageProxy;
  }

  const authCookie = cookies().get('auth');
  const signingSecret = getSessionSigningSecret();
  const currentSession =
    authCookie && signingSecret
      ? await parseSessionCookieValue(authCookie.value, signingSecret)
      : null;
  const currentUser = currentSession
    ? {
        username: currentSession.username ?? null,
        role: currentSession.role,
      }
    : null;

  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    ENABLE_REGISTER: enableRegister,
    IMAGE_PROXY: imageProxy,
    DOUBAN_PROXY: doubanProxy,
    SOURCE_PROBE: sourceProbe,
    HLS_PROXY: hlsProxy,
    SOURCE_RANKING_ENABLED:
      process.env.NEXT_PUBLIC_SOURCE_RANKING_ENABLED === 'true',
    CURRENT_USER: currentUser,
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-[rgb(var(--ui-bg))] text-[rgb(var(--ui-text))]`}
      >
        <FloatingShapes />
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
          <SiteProvider siteName={siteName} announcement={announcement}>
            {children}
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
