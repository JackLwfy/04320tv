import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const reading = { current: { temperature_2m: 18.5, weather_code: 61 }, current_units: { temperature_2m: '°C' } };
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Open-Meteo weather server', () => {
  it('works without credentials, coalesces requests and caches rounded coordinates', async () => {
    vi.stubEnv('QWEATHER_API_HOST', ''); vi.stubEnv('QWEATHER_API_KEY', '');
    const fetcher = vi.fn(async () => Response.json(reading)); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    const [a, b] = await Promise.all([server.currentWeather(30.671, 104.071), server.currentWeather(30.672, 104.072)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ temp: 19, text: '小雨', code: '61', kind: 'rain', attributions: ['https://open-meteo.com/'] });
    expect(a!.expiresAt - a!.fetchedAt).toBe(1800000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://api.open-meteo.com/v1/forecast?latitude=30.67&longitude=104.07&current=temperature_2m,weather_code&timezone=Asia%2FShanghai&forecast_days=1', { signal: expect.any(AbortSignal), redirect: 'error', cache: 'no-store' });
    await server.currentWeather(30.67, 104.07); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(server.weatherStatus()).toMatchObject({ configured: true, provider: 'open-meteo', cacheHits: 1 });
  });
  it('maps all supported WMO weather codes to Chinese text and rain/snow scenes', async () => {
    const { parseWeatherReading } = await import('./weather-server');
    const groups = { none: [0, 1, 2, 3, 45, 48], rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99], snow: [71, 73, 75, 77, 85, 86] };
    for (const [kind, codes] of Object.entries(groups)) for (const code of codes) {
      expect(parseWeatherReading({ ...reading, current: { temperature_2m: 18.5, weather_code: code } })).toMatchObject({ kind, code: String(code), text: expect.stringMatching(/[\u4e00-\u9fff]/) });
    }
  });
  it('rejects malformed upstream values instead of inventing weather', async () => {
    const { parseWeatherReading } = await import('./weather-server');
    for (const data of [null, {}, { ...reading, current_units: { temperature_2m: '°F' } }, ...[null, NaN, 71].map(temp => ({ ...reading, current: { temperature_2m: temp, weather_code: 61 } })), ...[null, '61', -1, 123, 61.5].map(code => ({ ...reading, current: { temperature_2m: 18, weather_code: code } }))]) expect(() => parseWeatherReading(data)).toThrow();
  });
  it('cools down after upstream failures or rate limits', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429 })); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    expect(await server.currentWeather(39.9, 116.4)).toBeNull();
    expect(await server.currentWeather(40, 117)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(server.weatherStatus()).toMatchObject({ failures: 1, blocked: 1 });
  });
  it('validates Chinese city results and coordinates and filters other countries', async () => {
    const city = { name: '成都', admin1: '四川', admin2: '成都市', country: '中国', country_code: 'CN', latitude: 30.66667, longitude: 104.06667 };
    const fetcher = vi.fn(async () => Response.json({ results: [city, { ...city, latitude: null }, { ...city, country_code: 'US' }, null] })); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    expect(await server.searchWeatherCities('<script>')).toEqual([]);
    expect(await server.currentWeather(91, 0)).toBeNull();
    expect(await server.searchWeatherCities('成都')).toEqual([{ name: '成都', region: '四川 · 成都市', country: '中国', lat: 30.66667, lon: 104.06667 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://geocoding-api.open-meteo.com/v1/search?name=%E6%88%90%E9%83%BD&countryCode=CN&count=5&language=zh&format=json', expect.anything());
  });
  it('accepts an empty city search and caches it', async () => {
    const fetcher = vi.fn(async () => Response.json({ generationtime_ms: 1 })); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    expect(await server.searchWeatherCities('不存在的城市')).toEqual([]);
    expect(await server.searchWeatherCities('不存在的城市')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds the hourly upstream budget and refreshes expired readings', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json(reading)); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    await server.currentWeather(0, 0); vi.advanceTimersByTime(1800001); await server.currentWeather(0, 0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let i = 1; i <= 125; i++) await server.currentWeather(0, i);
    expect(fetcher).toHaveBeenCalledTimes(120);
    expect(server.weatherStatus().budget.remaining).toBe(0);
  });
});
