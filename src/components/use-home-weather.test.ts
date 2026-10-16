import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeatherCity, WeatherReading } from '@/lib/weather';

const hooks = vi.hoisted(() => ({
  cursor: 0, dirty: false,
  slots: [] as Array<{ value: unknown }>,
  effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(),
  queued: [] as Array<() => void>,
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const slot = hooks.slots[hooks.cursor] ??= { value: initial }; hooks.cursor++;
    return [slot.value, (next: unknown) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (!Object.is(slot.value, value)) { slot.value = value; hooks.dirty = true; }
    }];
  },
  useRef(initial: unknown) {
    const slot = hooks.slots[hooks.cursor] ??= { value: { current: initial } }; hooks.cursor++;
    return slot.value;
  },
  useCallback(callback: unknown) { hooks.cursor++; return callback; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++; const previous = hooks.effects.get(index);
    if (previous && previous.deps.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks.queued.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      hooks.effects.set(index, { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined });
    });
  },
}));
import { useHomeWeather as runWeatherHook } from './use-home-weather';

const beijing: WeatherCity = { name: '北京', region: '北京市', country: '中国', lat: 39.9, lon: 116.4 };
const shanghai: WeatherCity = { name: '上海', region: '上海市', country: '中国', lat: 31.23, lon: 121.47 };
function weather(kind: WeatherReading['kind'] = 'rain'): WeatherReading {
  return { temp: 18, text: kind === 'rain' ? '小雨' : '小雪', code: '305', kind, fetchedAt: Date.now(), expiresAt: Date.now() + 1800000, attributions: ['QWeather'] };
}
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
describe('home weather lifecycle', () => {
  let value: ReturnType<typeof runWeatherHook>;
  let enabled = true;
  const render = () => {
    hooks.cursor = 0; hooks.dirty = false;
    value = runWeatherHook(enabled, true);
    hooks.queued.splice(0).forEach(run => run());
  };
  async function settle() {
    // Flush Promise chains and React-style state updates without a DOM renderer.
    for (let i = 0; i < 30; i++) { if (hooks.dirty) render(); await Promise.resolve(); }
  }
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 16));
    hooks.cursor = 0; hooks.dirty = false; hooks.slots = []; hooks.effects.clear(); hooks.queued = []; enabled = true;
    vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    for (const effect of hooks.effects.values()) effect.cleanup?.();
    vi.unstubAllGlobals(); vi.useRealTimers();
  });
  it('locks the initial background after 500ms while accepting late weather text', async () => {
    const request = deferred(); localStorage.setItem('04320-weather-preference', JSON.stringify(beijing));
    vi.stubGlobal('fetch', vi.fn(() => request.promise));
    render(); await settle(); expect(value.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(501); await settle(); expect(value.pending).toBe(false);
    request.resolve(Response.json({ weather: weather() })); await settle();
    expect(value.weather?.kind).toBe('rain'); expect(value.kind).toBe('none'); expect(value.city).toEqual(beijing);
  });
  it('accepts fast native city and weather results within the initial window', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/location') ? { city: beijing } : { weather: weather() })));
    render(); await settle();
    expect(value.kind).toBe('rain'); expect(value.pending).toBe(false); expect(value.city).toEqual(beijing);
  });
  it('never requests weather for persisted off preference or a disabled feature', async () => {
    localStorage.setItem('04320-weather-preference', '"off"');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(); await settle(); expect(value.preference).toBe('off'); expect(value.pending).toBe(false);
    enabled = false; value.choose('auto'); render(); await settle();
    expect(fetcher).not.toHaveBeenCalled(); expect(value.kind).toBe('none');
  });
  it('ignores an old city response even when fetch resolves after abort', async () => {
    localStorage.setItem('04320-weather-preference', JSON.stringify(beijing));
    const old = deferred(); const latest = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise));
    render(); await settle();
    value.choose(shanghai); await settle();
    latest.resolve(Response.json({ weather: weather('snow') })); await settle();
    old.resolve(Response.json({ weather: weather('rain') })); await settle();
    expect(value.city).toEqual(shanghai); expect(value.kind).toBe('snow');
    expect(JSON.parse(sessionStorage.getItem('04320-weather-cache-open-meteo')!).city).toEqual(shanghai);
  });
  it('clears an expired weather scene on failure and recovers on retry', async () => {
    localStorage.setItem('04320-weather-preference', JSON.stringify(beijing));
    const fetcher = vi.fn().mockImplementationOnce(async () => Response.json({ weather: weather() })).mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => Response.json({ weather: weather('snow') }));
    vi.stubGlobal('fetch', fetcher);
    render(); await settle(); expect(value.kind).toBe('rain');
    await vi.advanceTimersByTimeAsync(1800001); await settle();
    expect(value.weather).toBeNull(); expect(value.kind).toBe('none');
    await vi.advanceTimersByTimeAsync(300000); await settle();
    expect(fetcher).toHaveBeenCalledTimes(3); expect(value.kind).toBe('snow'); expect(value.message).toBe('');
  });
});
