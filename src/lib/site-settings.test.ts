import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  clearLiveProbeResultsDb: vi.fn(), loadLiveProbeResults: vi.fn(), saveLiveProbeResults: vi.fn(),
}));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('published site settings', () => {
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
