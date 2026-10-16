import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultHeroConfig, heroAt } from '@/lib/home-hero';

const hooks = vi.hoisted(() => ({ effect: undefined as undefined | (() => (() => void)), ref: undefined as undefined | { current: unknown }, update: vi.fn() }));
vi.mock('react', () => ({ useState: (initial: unknown) => [initial, hooks.update], useRef: (initial: unknown) => hooks.ref ??= { current: initial }, useEffect: (effect: () => (() => void)) => { hooks.effect = effect; } }));
import { useHomeHero as runHeroHook } from './use-home-hero';

describe('home hero scheduled image loading', () => {
  const initialTime = Date.UTC(2026, 9, 15, 8, 59, 50);
  const images: { src: string; onload?: () => void }[] = [];
  let cleanup: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime); hooks.update.mockReset(); hooks.ref = undefined; images.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - initialTime);
    vi.stubGlobal('window', { Image: class { src = ''; onload?: () => void; constructor() { images.push(this); } }, matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
  function mount(config = defaultHeroConfig) {
    runHeroHook(config, heroAt(config, initialTime), initialTime);
    cleanup = hooks.effect!();
  }
  it('changes both copy and mobile artwork only after the next image loads', () => {
    const config = structuredClone(defaultHeroConfig);
    config.slots.find(s => s.id === 'sunset')!.mobileImage = '/images/mobile-sunset.webp';
    mount(config); vi.advanceTimersByTime(10021);
    expect(images[0].src).toBe('/images/mobile-sunset.webp');
    expect(hooks.update).not.toHaveBeenCalled();
    images[0].onload!();
    expect(hooks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'sunset' }));
  });
  it('keeps the current scene on image failure, retries, and ignores loads after unmount', () => {
    mount(); vi.advanceTimersByTime(10021);
    expect(hooks.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(images).toHaveLength(2);
    cleanup!(); cleanup = undefined; images[1].onload!();
    expect(hooks.update).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('leaves a fixed theme unchanged across a time boundary', () => {
    mount({ ...defaultHeroConfig, mode: 'fixed', fixed: 'dawn' });
    vi.advanceTimersByTime(70000);
    expect(images).toHaveLength(0); expect(hooks.update).not.toHaveBeenCalled();
  });
  it('keeps the elapsed clock when weather changes after a time boundary', () => {
    const config = { ...defaultHeroConfig, mode: 'weather' as const };
    mount(config); vi.advanceTimersByTime(20000); cleanup!();
    runHeroHook(config, heroAt(config, initialTime), initialTime, 'rain'); cleanup = hooks.effect!();
    expect(images.at(-1)?.src).toBe('/images/hero/weather/rain-night-mobile.webp');
  });
  it('chooses the first resolved weather image without preloading a default scene', () => {
    const config = { ...defaultHeroConfig, mode: 'weather' as const };
    expect(runHeroHook(config, heroAt(config, initialTime), initialTime, 'none', true)).toBeNull(); cleanup = hooks.effect!();
    expect(images).toHaveLength(0); cleanup!();
    runHeroHook(config, heroAt(config, initialTime), initialTime, 'snow', false); cleanup = hooks.effect!();
    expect(images).toHaveLength(0);
    expect(hooks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'snow-day' }));
  });
  it('retries the actual old scene after navigation provides a newer server theme', () => {
    mount(); vi.advanceTimersByTime(10021);
    cleanup!();
    const now = Date.now();
    runHeroHook(defaultHeroConfig, heroAt(defaultHeroConfig, now), now);
    cleanup = hooks.effect!();
    expect(images).toHaveLength(2);
    images[1].onload!();
    expect(hooks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'sunset' }));
  });
});
