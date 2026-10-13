import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '04320 · 光影之间',
    short_name: '04320',
    description: '免费在线视频搜索与观看平台',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1311',
    theme_color: '#0f1311',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
