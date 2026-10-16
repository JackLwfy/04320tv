import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const reading = { condition: { text: '小雨', code: '305' }, temperature: { value: 18.5, unit: '°C' }, precipitation: { type: 'rain' }, metadata: { attributions: ['https://developer.qweather.com/attribution.html'] } };
beforeEach(() => { vi.resetModules(); vi.stubEnv('QWEATHER_API_HOST', 'test.qweatherapi.com'); vi.stubEnv('QWEATHER_API_KEY', 'test-only-key'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('weather server', () => {
  it('fails closed for missing credentials and arbitrary API hosts', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    for (const host of ['', 'https://test.qweatherapi.com', 'test.qweatherapi.com.evil.test', 'localhost', 'test.qweatherapi.com/path']) {
      vi.stubEnv('QWEATHER_API_HOST', host);
      expect(server.weatherConfigured()).toBe(false);
      expect(await server.currentWeather(39.9, 116.4)).toBeNull();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the v1 contract, coalesces requests and caches rounded coordinates', async () => {
    const fetcher = vi.fn(async () => Response.json(reading)); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    const [a, b] = await Promise.all([server.currentWeather(39.901, 116.401), server.currentWeather(39.902, 116.402)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ temp: 19, kind: 'rain', attributions: reading.metadata.attributions });
    expect(a!.expiresAt - a!.fetchedAt).toBe(1800000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://test.qweatherapi.com/weather/v1/current/39.90/116.40?lang=zh', expect.objectContaining({ headers: { 'X-QW-Api-Key': 'test-only-key' }, redirect: 'error' }));
    await server.currentWeather(39.9, 116.4); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(server.weatherStatus())).not.toContain('test-only-key');
  });
  it('rejects invalid weather and cools down after upstream failures', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...reading, temperature: { value: 60, unit: '°F' } })); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    expect(await server.currentWeather(39.9, 116.4)).toBeNull();
    expect(await server.currentWeather(40, 117)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(server.weatherStatus()).toMatchObject({ failures: 1, blocked: 1 });
    expect(() => server.parseWeatherReading({ ...reading, metadata: {} })).toThrow();
  });
  it('validates city queries and upstream coordinates', async () => {
    const fetcher = vi.fn(async () => Response.json({ code: '200', location: [{ name: '北京', adm1: '北京市', country: '中国', lat: '39.9', lon: '116.4' }, { name: 'invalid', adm1: '', country: '中国', lat: '', lon: '' }] })); vi.stubGlobal('fetch', fetcher);
    const server = await import('./weather-server');
    expect(await server.searchWeatherCities('<script>')).toEqual([]);
    expect(await server.searchWeatherCities('北京')).toEqual([{ name: '北京', region: '北京市', country: '中国', lat: 39.9, lon: 116.4 }]);
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
