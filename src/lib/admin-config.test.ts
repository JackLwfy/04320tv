import { describe, expect, it } from 'vitest';
import { configRevision, managedKeys, settingsFromEnv, settingsToEnv } from './admin-config';
import { initialSettings } from './admin-settings';
import { defaultHeroConfig } from './home-hero';

describe('administrator configuration environment mapping', () => {
  it('publishes all six hero slots and includes their content in revision checks', () => {
    const env = settingsToEnv(initialSettings, {});
    expect(settingsFromEnv(env).hero).toEqual(defaultHeroConfig);
    const draft = structuredClone(initialSettings);
    draft.hero.slots[0].caption = '新的清晨。';
    expect(configRevision(settingsToEnv(draft, env))).not.toBe(configRevision(env));
    expect(() => settingsToEnv({ ...initialSettings, hero: null }, {})).toThrow();
  });
  it('round trips all newsletter themes and defaults the new entry to disabled', () => {
    expect(settingsFromEnv({})).toMatchObject({ newsletterEnabled: false, newsletterStyle: 'lighthouse' });
    for (const newsletterStyle of ['lighthouse', 'ticket', 'minimal'] as const) {
      const result = settingsToEnv({ ...initialSettings, newsletterEnabled: true, newsletterStyle }, {});
      expect(settingsFromEnv(result)).toMatchObject({ newsletterEnabled: true, newsletterStyle });
    }
    expect(() => settingsToEnv({ ...initialSettings, newsletterStyle: 'other' }, {})).toThrow();
  });
  it('writes only the managed whitelist and never copies credential fields', () => {
    const result = settingsToEnv({ ...initialSettings, ADMIN_PASSWORD_HASH: 'injected', PASSWORD: 'injected', arbitrary: 'injected' }, { PASSWORD: 'private', ADMIN_SESSION_SECRET: 'private', UNRELATED_SETTING: 'keep' });
    expect(Object.keys(result).every(key => managedKeys.includes(key))).toBe(true);
    for (const key of ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'PASSWORD', 'UNRELATED_SETTING', 'arbitrary']) expect(result).not.toHaveProperty(key);
    expect(result).toMatchObject({ NEXT_PUBLIC_SITE_NAME: '04320TV', NEXT_PUBLIC_DEFAULT_AUTOPLAY: 'true', DEFAULT_SOURCES: '[]' });
  });
  it('preserves source-only metadata and disabled states through edits and reordering', () => {
    const previous = {
      DEFAULT_SOURCES: JSON.stringify([{ name: 'first', url: 'https://one.example/api', detail: 'https://one.example/detail', isAdult: true, enabled: false }, { name: 'second', url: 'https://two.example/api', detail: 'https://two.example/detail', isAdult: false }]),
      DEFAULT_LIVE_SOURCES: JSON.stringify([{ name: 'live', url: 'https://live.example/list.m3u', epg: 'https://live.example/epg.xml', enabled: false }]),
      DEFAULT_SUBSCRIPTIONS: JSON.stringify(['https://sub.example/list.json']),
    };
    const draft = settingsFromEnv(previous);
    expect(draft.sources.map(s => s.enabled)).toEqual([false, true, false, true]);
    draft.sources.reverse();
    draft.sources.find(s => s.id === 'vod-0')!.name = 'renamed';
    const result = settingsToEnv(draft, previous);
    expect(JSON.parse(result.DEFAULT_SOURCES)).toEqual([
      { name: 'second', url: 'https://two.example/api', detail: 'https://two.example/detail', isAdult: false, enabled: true },
      { name: 'renamed', url: 'https://one.example/api', detail: 'https://one.example/detail', isAdult: true, enabled: false },
    ]);
    expect(JSON.parse(result.DEFAULT_LIVE_SOURCES)[0]).toMatchObject({ epg: 'https://live.example/epg.xml', enabled: false });
    expect(JSON.parse(result.DEFAULT_SUBSCRIPTIONS)[0]).toMatchObject({ url: 'https://sub.example/list.json', enabled: true });
  });
  it('enforces the 1000 UTF-8 byte cloud limit after JSON serialization', () => {
    const item = { name: '影院', url: 'https://video.example/', enabled: true };
    const overhead = Buffer.byteLength(JSON.stringify([item]), 'utf8');
    const draft = { ...initialSettings, sources: [{ ...item, id: 'new-one', kind: 'vod' as const, url: item.url + 'a'.repeat(1000 - overhead) }] };
    expect(Buffer.byteLength(settingsToEnv(draft, {}).DEFAULT_SOURCES)).toBe(1000);
    draft.sources[0].url += 'a';
    expect(() => settingsToEnv(draft, {})).toThrow('1000 字节');
  });
  it('revisions detect managed changes while ignoring unrelated credentials', () => {
    const original = { NEXT_PUBLIC_SITE_NAME: 'one', PASSWORD: 'private-one' };
    expect(configRevision(original)).not.toBe(configRevision({ ...original, PASSWORD: 'private-two' }));
    expect(configRevision(original)).toBe(configRevision({ ...original, EDGEONE_API_TOKEN: 'private-token' }));
    expect(configRevision(original)).not.toBe(configRevision({ ...original, NEXT_PUBLIC_SITE_NAME: 'two' }));
    expect(configRevision(original)).not.toBe(configRevision({ ...original, ADMIN_CONFIG_REVISION: 'new-revision' }));
  });
});
