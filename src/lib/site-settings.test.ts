import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  clearLiveProbeResultsDb: vi.fn(), loadLiveProbeResults: vi.fn(), saveLiveProbeResults: vi.fn(),
}));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('published site settings', () => {
  it('reads all four published weather scenes', async () => {
    const { defaultHeroConfig } = await import('./home-hero');
    vi.stubEnv('NEXT_PUBLIC_HERO_MODE', 'weather');
    for (const slot of defaultHeroConfig.weather) vi.stubEnv(`NEXT_PUBLIC_HERO_${slot.id.toUpperCase().replaceAll('-', '_')}`, JSON.stringify({ ...slot, caption: `自定义${slot.name}` }));
    const { siteSettings } = await import('./site-settings');
    expect(siteSettings.hero.mode).toBe('weather');
    expect(siteSettings.hero.weather.map(slot => slot.caption)).toEqual(defaultHeroConfig.weather.map(slot => `自定义${slot.name}`));
  });
  it('reads explicitly published mobile and desktop hero configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_HERO_MODE', 'fixed');
    vi.stubEnv('NEXT_PUBLIC_HERO_FIXED', 'dawn');
    const { defaultHeroConfig } = await import('./home-hero');
    vi.stubEnv('NEXT_PUBLIC_HERO_DAWN', JSON.stringify({ ...defaultHeroConfig.slots[0], mobilePosition: '80% 30%' }));
    const { siteSettings } = await import('./site-settings');
    expect(siteSettings.hero.mode).toBe('fixed');
    expect(siteSettings.hero.slots[0]).toMatchObject({ mobilePosition: '80% 30%', mobileImage: '/images/hero/dawn.webp' });
  });
  it('uses configured identity and allows an empty announcement', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_NAME', '我的影院');
    vi.stubEnv('NEXT_PUBLIC_SITE_SUBTITLE', '每日好片');
    vi.stubEnv('NEXT_PUBLIC_SITE_DESCRIPTION', '自定义介绍');
    vi.stubEnv('NEXT_PUBLIC_SITE_ANNOUNCEMENT', '');
    vi.stubEnv('NEXT_PUBLIC_RECOMMENDATIONS_ENABLED', 'false');
    const { siteSettings, siteTitle } = await import('./site-settings');
    expect(siteTitle).toBe('我的影院 · 每日好片');
    expect(siteSettings).toMatchObject({ description: '自定义介绍', announcement: '', recommendationsEnabled: false });
    const { default: manifest } = await import('@/app/manifest');
    expect(manifest()).toMatchObject({ name: siteTitle, short_name: '我的影院', description: '自定义介绍' });
  });

  it('applies playback defaults to new visitors and preserves saved preferences after hydration', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_AUTOPLAY', 'false');
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_AD_FILTER', 'false');
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_ADULT_FILTER', 'false');
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ state: { autoplayNext: true, adFilter: true, yellowFilter: true }, version: 0 }),
      setItem: vi.fn(), removeItem: vi.fn(),
    });
    const { useAppStore } = await import('./store');
    expect(useAppStore.getState()).toMatchObject({ autoplayNext: false, adFilter: false, yellowFilter: false });
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState()).toMatchObject({ autoplayNext: true, adFilter: true, yellowFilter: true });
  });
});
