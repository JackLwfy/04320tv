import { WEATHER_TTL, validWeatherCoordinates, type WeatherCity, type WeatherReading } from './weather';

const cache = new Map<string, { value: unknown; until: number }>();
const inflight = new Map<string, Promise<unknown>>();
const stats = { requests: 0, cacheHits: 0, failures: 0, blocked: 0 };
let windowUntil = 0; let windowRequests = 0; let cooldownUntil = 0;
const LIMIT = 120;
export function weatherStatus() {
  return { configured: true, provider: 'open-meteo', message: 'Open-Meteo 免费天气已接入，无需账号或密钥；仅限非商业用途。统计仅代表当前实例。', cacheEntries: cache.size, inflight: inflight.size, ...stats, budget: { limit: LIMIT, remaining: Date.now() >= windowUntil ? LIMIT : LIMIT - windowRequests, resetsAt: windowUntil }, cooldownUntil };
}

async function cached<T>(path: string, parse: (data: unknown) => T): Promise<T | null> {
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && hit.until > now) { stats.cacheHits++; return hit.value as T; }
  if (inflight.has(path)) return inflight.get(path) as Promise<T | null>;
  if (now >= windowUntil) { windowUntil = now + 60 * 60 * 1000; windowRequests = 0; }
  // shortcut: 缓存和预算仅限本实例；总流量接近免费额度时升级共享限流。
  if (now < cooldownUntil || windowRequests >= LIMIT || inflight.size >= 8) { stats.blocked++; return null; }
  windowRequests++; stats.requests++;
  const job = (async () => {
    try {
      const response = await fetch(path, { signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('upstream');
      const value = parse(await response.json());
      for (const [key, entry] of cache) if (entry.until <= Date.now()) cache.delete(key);
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(path, { value, until: Date.now() + WEATHER_TTL });
      return value;
    } catch {
      stats.failures++; cooldownUntil = Date.now() + 60 * 1000;
      return null;
    } finally { inflight.delete(path); }
  })();
  inflight.set(path, job);
  return job;
}

const conditions: Record<number, [string, WeatherReading['kind']]> = {
  0: ['晴', 'none'], 1: ['大部晴朗', 'none'], 2: ['局部多云', 'none'], 3: ['阴天', 'none'],
  45: ['雾', 'none'], 48: ['雾凇', 'none'],
  51: ['小毛毛雨', 'rain'], 53: ['毛毛雨', 'rain'], 55: ['强毛毛雨', 'rain'],
  56: ['轻微冻毛毛雨', 'rain'], 57: ['强冻毛毛雨', 'rain'],
  61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'],
  66: ['轻微冻雨', 'rain'], 67: ['强冻雨', 'rain'],
  71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'snow'], 77: ['雪粒', 'snow'],
  80: ['小阵雨', 'rain'], 81: ['中阵雨', 'rain'], 82: ['强阵雨', 'rain'],
  85: ['小阵雪', 'snow'], 86: ['强阵雪', 'snow'],
  95: ['雷暴', 'rain'], 96: ['雷暴伴小冰雹', 'rain'], 97: ['强雷暴', 'rain'], 99: ['雷暴伴大冰雹', 'rain'],
};
export function parseWeatherReading(data: unknown): WeatherReading {
  const value = data as { current?: { temperature_2m?: unknown; weather_code?: unknown }; current_units?: { temperature_2m?: unknown } };
  const temp = value?.current?.temperature_2m;
  const code = value?.current?.weather_code;
  if (typeof temp !== 'number' || !Number.isFinite(temp) || temp < -100 || temp > 70 || value.current_units?.temperature_2m !== '°C' || typeof code !== 'number' || !Number.isInteger(code) || !Object.hasOwn(conditions, code)) throw new Error('invalid weather');
  const [text, kind] = conditions[code];
  const fetchedAt = Date.now();
  return { temp: Math.round(temp), text, code: String(code), kind, fetchedAt, expiresAt: fetchedAt + WEATHER_TTL, attributions: ['https://open-meteo.com/'] };
}

export async function currentWeather(lat: number, lon: number) {
  if (!validWeatherCoordinates(lat, lon)) return null;
  return cached(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai&forecast_days=1`, parseWeatherReading);
}

export async function searchWeatherCities(query: string): Promise<WeatherCity[]> {
  const q = query.trim();
  if (!q || q.length > 40 || !/^[\p{L}\p{N}\s.-]+$/u.test(q)) return [];
  return await cached(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&countryCode=CN&count=5&language=zh&format=json`, data => {
    const value = data as { error?: boolean; results?: Array<{ name?: unknown; admin1?: unknown; admin2?: unknown; country?: unknown; country_code?: unknown; latitude?: unknown; longitude?: unknown }> };
    if (!value || value.error || (value.results !== undefined && !Array.isArray(value.results))) throw new Error('invalid cities');
    return (value.results || []).slice(0, 5).flatMap(city => {
      if (!city) return [];
      const lat = typeof city.latitude === 'number' ? city.latitude : NaN;
      const lon = typeof city.longitude === 'number' ? city.longitude : NaN;
      const district = typeof city.admin2 === 'string' && city.admin2.length <= 80 && city.admin2 !== city.admin1 ? city.admin2 : '';
      return typeof city.name === 'string' && city.name.length > 0 && city.name.length <= 80 && typeof city.admin1 === 'string' && city.admin1.length <= 80 && typeof city.country === 'string' && city.country.length <= 80 && city.country_code === 'CN' && validWeatherCoordinates(lat, lon) ? [{ name: city.name, region: [city.admin1, district].filter(Boolean).join(' · '), country: city.country, lat, lon }] : [];
    });
  }) || [];
}
