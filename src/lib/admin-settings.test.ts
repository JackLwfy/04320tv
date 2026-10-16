import { describe, expect, it } from 'vitest';
import { changes, describeValue, initialSettings, parseSettings, validateSettings } from './admin-settings';

const source = { id: 'test-source', kind: 'vod' as const, name: '测试源', url: 'https://video.example/api', enabled: true };

describe('admin configuration', () => {
  it('describes weather mode, fixed weather themes, and weather edits in the publish review', () => {
    const hero = structuredClone(initialSettings.hero);
    hero.mode = 'weather';
    expect(describeValue(hero)).toContain('北京时间与当地天气自动切换');
    expect(describeValue(hero)).toContain('雨日 · 天气 · 白昼');
    expect(describeValue(hero)).toContain('雪夜 · 天气 · 入夜');
    hero.weather[0].caption = '审核天气文案';
    hero.weather[0].mobilePosition = '40% 60%';
    expect(describeValue(hero)).toContain('审核天气文案');
    expect(describeValue(hero)).toContain('手机：/images/hero/weather/rain-day-mobile.webp（40% 60%）');
    expect(changes(initialSettings, { ...initialSettings, hero })).toEqual(['hero']);
    hero.mode = 'fixed';
    hero.fixed = 'snow-night';
    expect(describeValue(hero).split('\n')[0]).toBe('固定：雪夜');
  });
  it('accepts older drafts without hero and describes hero changes for confirmation', () => {
    const { hero, ...legacy } = initialSettings;
    expect(parseSettings(legacy).hero).toEqual(hero);
    expect(describeValue(hero)).toContain('北京时间自动切换');
    expect(describeValue(hero)).toContain('手机：/images/hero/dawn.webp（100% 50%）');
    expect(validateSettings({ ...initialSettings, hero: { ...hero, slots: [] } })?.section).toBe('hero');
  });
  it('tracks reversible changes without altering the published snapshot', () => {
    const draft = structuredClone(initialSettings);
    draft.live = false;
    draft.sources.push({ ...source, name: '新的源' });
    expect(changes(initialSettings, draft)).toEqual(['live', 'sources']);
    expect(describeValue(draft.sources)).toContain('新的源');
    expect(describeValue(draft.sources)).not.toBe(describeValue(initialSettings.sources));
    expect(initialSettings.live).toBe(true);
    expect(changes(initialSettings, structuredClone(initialSettings))).toEqual([]);
  });
  it('validates the whole draft, including hidden source tabs', () => {
    expect(validateSettings(initialSettings)).toBeNull();
    expect(validateSettings({ ...initialSettings, name: ' ' })?.section).toBe('site');
    expect(validateSettings({ ...initialSettings, description: '中'.repeat(201) })?.section).toBe('site');
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.com', 'not-a-url']) {
      expect(validateSettings({ ...initialSettings, sources: [{ ...source, url }] })?.section).toBe('sources');
    }
  });
  it.each([null, [], 'settings', 4, { ...initialSettings, name: 2 }, { ...initialSettings, live: 'false' }, { ...initialSettings, logo: 'unknown' }, { ...initialSettings, imageMode: 'unknown' }, { ...initialSettings, recommendSource: 'unknown' }, { ...initialSettings, sources: [null] }, { ...initialSettings, sources: [{ ...source, enabled: 'true' }] }, { ...initialSettings, sources: [source, source] }, { ...initialSettings, sources: Array.from({ length: 51 }, (_, i) => ({ ...source, id: `test-${i}` })) }])('rejects invalid input %# at the trust boundary', (value) => {
    expect(() => parseSettings(value)).toThrow();
  });
  it('strips unknown fields, trims names, and starts without demonstration sources', () => {
    expect(initialSettings.sources).toEqual([]);
    expect(parseSettings({ ...initialSettings, name: '  我的影院  ', secret: 'injected', sources: [{ ...source, secret: 'injected' }] })).toEqual({ ...initialSettings, name: '我的影院', sources: [source] });
  });
});
