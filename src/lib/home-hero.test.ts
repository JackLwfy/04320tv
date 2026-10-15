import { describe, expect, it } from 'vitest';
import { defaultHeroConfig, heroAt, heroEnvKeys, heroFromEnv, heroToEnv, parseHeroConfig } from './home-hero';

describe('home hero schedule', () => {
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
