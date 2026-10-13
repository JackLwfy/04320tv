import type { MetadataRoute } from 'next';
import { brandPath } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '04320TV · 光影之间',
    short_name: '04320TV',
    description: '免费在线视频搜索与观看平台',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1311',
    theme_color: '#0f1311',
    icons: [
      {
        src: `${brandPath}/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${brandPath}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
