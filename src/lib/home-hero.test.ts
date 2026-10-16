import { describe, expect, it } from 'vitest';
import { defaultHeroConfig, heroAt, heroForWeather, heroEnvKeys, heroFromEnv, heroToEnv, parseHeroConfig } from './home-hero';

describe('home hero schedule', () => {
  it('extends old configurations with four independent mobile weather scenes', () => {
    const legacy = { mode: defaultHeroConfig.mode, fixed: defaultHeroConfig.fixed, slots: defaultHeroConfig.slots };
    expect(parseHeroConfig(legacy)).toEqual(defaultHeroConfig);
    for (const slot of defaultHeroConfig.weather) {
      expect(slot.mobileImage).toBe(`/images/hero/weather/${slot.id}-mobile.webp`);
      expect(slot.mobilePosition).toBe('50% 50%');
    }
    expect(() => parseHeroConfig({ ...defaultHeroConfig, weather: defaultHeroConfig.weather.slice(1) })).toThrow();
    expect(() => parseHeroConfig({ ...defaultHeroConfig, weather: Array(4).fill(defaultHeroConfig.weather[0]) })).toThrow();
  });
  it('uses configured daylight periods for weather and preserves fixed scenes', () => {
    const config = { ...structuredClone(defaultHeroConfig), mode: 'weather' as const };
    for (const [time, period] of [['04:59', 'night'], ['05:00', 'day'], ['09:00', 'day'], ['12:00', 'day'], ['17:00', 'night'], ['19:00', 'night'], ['23:00', 'night']]) {
      const date = new Date(`2026-10-15T${time}:00+08:00`);
      for (const kind of ['rain', 'snow'] as const) expect(heroForWeather(config, date, kind).id).toBe(`${kind}-${period}`);
      expect(heroForWeather(config, date, 'none')).toEqual(heroAt(config, date));
      expect(heroForWeather({ ...defaultHeroConfig, mode: 'auto' }, date, 'rain')).toEqual(heroAt(defaultHeroConfig, date));
      expect(heroForWeather({ ...config, mode: 'fixed', fixed: 'snow-day' }, date, 'rain').id).toBe('snow-day');
    }
    config.slots.find(slot => slot.id === 'sunset')!.start = 1000;
    expect(heroForWeather(config, new Date('2026-10-15T16:40:00+08:00'), 'rain').id).toBe('rain-night');
  });
  it('publishes weather with underscore environment keys and enforces weather byte limits', () => {
    const config = structuredClone(defaultHeroConfig);
    const env = heroToEnv(config);
    expect(env.NEXT_PUBLIC_HERO_RAIN_DAY).toBe(JSON.stringify(config.weather[0]));
    config.weather[0].image = `https://example.com/${'a'.repeat(475)}`;
    config.weather[0].mobileImage = config.weather[0].image;
    expect(() => heroToEnv(config)).toThrow('1000 字节');
  });
  it('keeps the existing mobile right-aligned landscape composition by default', () => {
    for (const slot of defaultHeroConfig.slots) {
      expect(slot.mobileImage).toBe(slot.image);
      expect(slot.mobilePosition).toBe('100% 50%');
      expect(slot.shade).toBe(0);
    }
  });
  it('uses Beijing time at every boundary and across midnight', () => {
    for (const [time, id] of [['04:59', 'midnight'], ['05:00', 'dawn'], ['09:00', 'day'], ['12:00', 'afternoon'], ['17:00', 'sunset'], ['19:00', 'evening'], ['23:00', 'midnight'], ['00:00', 'midnight']]) {
      expect(heroAt(defaultHeroConfig, new Date(`2026-10-15T${time}:00+08:00`)).id).toBe(id);
    }
    expect(heroAt({ ...defaultHeroConfig, mode: 'fixed', fixed: 'day' }, Date.parse('2026-10-15T00:00:00Z')).id).toBe('day');
  });
  it('round trips six cloud slots and falls back safely on broken published configuration', () => {
    const env = heroToEnv(defaultHeroConfig);
    expect(Object.keys(env).sort()).toEqual([...heroEnvKeys].sort());
    expect(heroFromEnv(env)).toEqual(defaultHeroConfig);
    expect(heroFromEnv({ ...env, NEXT_PUBLIC_HERO_DAWN: 'broken' })).toEqual(defaultHeroConfig);
    expect(Object.values(env).every(value => new TextEncoder().encode(value).length <= 1000)).toBe(true);
  });
  it('rejects duplicate times, invalid ids, unsafe image URLs, and malformed focal points', () => {
    for (const patch of [{ start: 540 }, { start: 1440 }, { start: 2.5 }, { id: 'unknown' }, { image: 'https://user:pass@example.com/a.webp' }, { image: 'javascript:alert(1)' }, { mobileImage: '/images/../../private.png' }, { position: '101% 50%' }, { mobilePosition: '50% auto' }, { title: 'one\ntwo\nthree' }, { shade: 81 }]) {
      const config = structuredClone(defaultHeroConfig);
      Object.assign(config.slots[0], patch);
      expect(() => parseHeroConfig(config)).toThrow();
    }
    expect(() => parseHeroConfig({ ...defaultHeroConfig, slots: defaultHeroConfig.slots.slice(1) })).toThrow();
  });
  it('checks cloud bytes after serialization, including both image URLs', () => {
    const config = structuredClone(defaultHeroConfig);
    config.slots[0].image = `https://example.com/${'a'.repeat(475)}`;
    config.slots[0].mobileImage = config.slots[0].image;
    expect(() => heroToEnv(config)).toThrow('1000 字节');
  });
});
