import type { MetadataRoute } from 'next';
import { brandPath } from '@/lib/brand';
import { siteSettings, siteTitle } from '@/lib/site-settings';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteTitle,
    short_name: siteSettings.name,
    description: siteSettings.description,
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
