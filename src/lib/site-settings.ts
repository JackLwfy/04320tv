import { heroFromEnv } from './home-hero';

// NEXT_PUBLIC 值在构建时内联；后台发布配置后需要重新部署才能更新前台。
export const siteSettings = {
  hero: heroFromEnv({
    NEXT_PUBLIC_HERO_MODE: process.env.NEXT_PUBLIC_HERO_MODE,
    NEXT_PUBLIC_HERO_FIXED: process.env.NEXT_PUBLIC_HERO_FIXED,
    NEXT_PUBLIC_HERO_DAWN: process.env.NEXT_PUBLIC_HERO_DAWN,
    NEXT_PUBLIC_HERO_DAY: process.env.NEXT_PUBLIC_HERO_DAY,
    NEXT_PUBLIC_HERO_AFTERNOON: process.env.NEXT_PUBLIC_HERO_AFTERNOON,
    NEXT_PUBLIC_HERO_SUNSET: process.env.NEXT_PUBLIC_HERO_SUNSET,
    NEXT_PUBLIC_HERO_EVENING: process.env.NEXT_PUBLIC_HERO_EVENING,
    NEXT_PUBLIC_HERO_MIDNIGHT: process.env.NEXT_PUBLIC_HERO_MIDNIGHT,
    NEXT_PUBLIC_HERO_RAIN_DAY: process.env.NEXT_PUBLIC_HERO_RAIN_DAY,
    NEXT_PUBLIC_HERO_RAIN_NIGHT: process.env.NEXT_PUBLIC_HERO_RAIN_NIGHT,
    NEXT_PUBLIC_HERO_SNOW_DAY: process.env.NEXT_PUBLIC_HERO_SNOW_DAY,
    NEXT_PUBLIC_HERO_SNOW_NIGHT: process.env.NEXT_PUBLIC_HERO_SNOW_NIGHT,
  }),
  newsletterEnabled: process.env.NEXT_PUBLIC_NEWSLETTER_ENABLED === 'true',
  newsletterStyle: process.env.NEXT_PUBLIC_NEWSLETTER_STYLE === 'ticket' ? 'ticket' as const : process.env.NEXT_PUBLIC_NEWSLETTER_STYLE === 'minimal' ? 'minimal' as const : 'lighthouse' as const,
  name: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || '04320TV',
  subtitle: process.env.NEXT_PUBLIC_SITE_SUBTITLE ?? '光影之间',
  description: process.env.NEXT_PUBLIC_SITE_DESCRIPTION ?? '搜索电影、剧集，找到下一段光影。',
  announcement: process.env.NEXT_PUBLIC_SITE_ANNOUNCEMENT ?? '有些故事，仍在等你。',
  recommendationsEnabled: process.env.NEXT_PUBLIC_RECOMMENDATIONS_ENABLED !== 'false',
  defaultAutoplay: process.env.NEXT_PUBLIC_DEFAULT_AUTOPLAY !== 'false',
  defaultAdFilter: process.env.NEXT_PUBLIC_DEFAULT_AD_FILTER !== 'false',
  defaultAdultFilter: process.env.NEXT_PUBLIC_DEFAULT_ADULT_FILTER !== 'false',
};

export const siteTitle = [siteSettings.name, siteSettings.subtitle].filter(Boolean).join(' · ');
