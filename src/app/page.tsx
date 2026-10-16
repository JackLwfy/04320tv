import HomePage from '@/components/home-page';
import { siteSettings } from '@/lib/site-settings';
import { heroAt } from '@/lib/home-hero';
import { weatherConfigured } from '@/lib/weather-server';

// 首屏按请求时间选图，避免静态构建时间或浏览器时区决定全天主题。
export const dynamic = 'force-dynamic';

export default function Page() {
  const now = Date.now();
  return <HomePage initialHero={heroAt(siteSettings.hero, now)} initialTime={now} weatherEnabled={siteSettings.hero.mode === 'weather' && weatherConfigured()} />;
}
