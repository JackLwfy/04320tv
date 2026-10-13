import type { Metadata, Viewport } from 'next';
import { brandPath } from '@/lib/brand';
import { siteSettings, siteTitle } from '@/lib/site-settings';
import './globals.css';
import './cinema.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: `${siteTitle} - 电影与剧集搜索`,
    template: `%s - ${siteTitle}`,
  },
  description: siteSettings.description,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: `${brandPath}/icon.svg`, type: 'image/svg+xml' },
      { url: `${brandPath}/icon-96.png`, sizes: '96x96', type: 'image/png' },
    ],
    apple: [{ url: `${brandPath}/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0f1311',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前同步主题，避免亮暗闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('libretv-theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
