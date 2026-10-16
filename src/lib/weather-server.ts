import { WEATHER_TTL, validWeatherCoordinates, type WeatherCity, type WeatherReading } from './weather';

const cache = new Map<string, { value: unknown; until: number }>();
const inflight = new Map<string, Promise<unknown>>();
const stats = { requests: 0, cacheHits: 0, failures: 0, blocked: 0 };
let windowUntil = 0; let windowRequests = 0; let cooldownUntil = 0;
const LIMIT = 120;
function configuration() {
  const host = process.env.QWEATHER_API_HOST?.trim() || '';
  const key = process.env.QWEATHER_API_KEY?.trim() || '';
  return host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+qweatherapi\.com$/.test(host) && key && !/[\r\n]/.test(key) ? { host, key } : null;
}
export function weatherConfigured() { return !!configuration(); }
export function weatherStatus() {
  return { configured: weatherConfigured(), message: weatherConfigured() ? '天气服务已配置；统计仅代表当前实例。' : '尚未配置有效的天气服务凭据，首页使用默认场景。', cacheEntries: cache.size, inflight: inflight.size, ...stats, budget: { limit: LIMIT, remaining: Date.now() >= windowUntil ? LIMIT : LIMIT - windowRequests, resetsAt: windowUntil }, cooldownUntil };
}

async function cached<T>(path: string, parse: (data: unknown) => T): Promise<T | null> {
  const config = configuration();
  if (!config) return null;
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && hit.until > now) { stats.cacheHits++; return hit.value as T; }
  if (inflight.has(path)) return inflight.get(path) as Promise<T | null>;
  if (now >= windowUntil) { windowUntil = now + 60 * 60 * 1000; windowRequests = 0; }
  // shortcut: 缓存和每小时预算仅限本实例；多节点上线须在供应商或网关设置总配额。
  if (now < cooldownUntil || windowRequests >= LIMIT || inflight.size >= 8) { stats.blocked++; return null; }
  windowRequests++; stats.requests++;
  const job = (async () => {
    try {
      const response = await fetch(`https://${config.host}${path}`, { headers: { 'X-QW-Api-Key': config.key }, signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
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

export function parseWeatherReading(data: unknown): WeatherReading {
  const value = data as { condition?: { text?: unknown; code?: unknown }; temperature?: { value?: unknown; unit?: unknown }; precipitation?: { type?: unknown }; metadata?: { attributions?: unknown } };
  const temp = value?.temperature?.value;
  const text = value?.condition?.text;
  const code = value?.condition?.code;
  if (typeof temp !== 'number' || !Number.isFinite(temp) || temp < -100 || temp > 70 || value.temperature?.unit !== '°C' || typeof text !== 'string' || !text || text.length > 80 || typeof code !== 'string' || !/^\d{3,4}$/.test(code)) throw new Error('invalid weather');
  const attributions = value.metadata?.attributions;
  if (!Array.isArray(attributions) || !attributions.length || !attributions.every(item => typeof item === 'string' && item.length <= 500)) throw new Error('missing attribution');
  const precipitation = value.precipitation?.type;
  const kind = precipitation === 'snow' || precipitation === 'sleet' || /雪/.test(text) ? 'snow' : precipitation === 'rain' || /雨/.test(text) ? 'rain' : 'none';
  const fetchedAt = Date.now();
  return { temp: Math.round(temp), text, code, kind, fetchedAt, expiresAt: fetchedAt + WEATHER_TTL, attributions };
}

export async function currentWeather(lat: number, lon: number) {
  if (!validWeatherCoordinates(lat, lon)) return null;
  return cached(`/weather/v1/current/${lat.toFixed(2)}/${lon.toFixed(2)}?lang=zh`, parseWeatherReading);
}

export async function searchWeatherCities(query: string): Promise<WeatherCity[]> {
  const q = query.trim();
  if (!q || q.length > 40 || !/^[\p{L}\p{N}\s.-]+$/u.test(q)) return [];
  return await cached(`/geo/v2/city/lookup?location=${encodeURIComponent(q)}&range=cn&number=5&lang=zh`, data => {
    const value = data as { code?: string; location?: Array<{ name?: unknown; adm1?: unknown; country?: unknown; lat?: unknown; lon?: unknown }> };
    if (value?.code === '404') return [];
    if (value?.code !== '200' || !Array.isArray(value.location)) throw new Error('invalid cities');
    return value.location.slice(0, 5).flatMap(city => {
      const lat = typeof city.lat === 'string' && city.lat.trim() ? Number(city.lat) : NaN;
      const lon = typeof city.lon === 'string' && city.lon.trim() ? Number(city.lon) : NaN;
      return typeof city.name === 'string' && city.name.length > 0 && city.name.length <= 80 && typeof city.adm1 === 'string' && city.adm1.length <= 80 && typeof city.country === 'string' && city.country.length <= 80 && validWeatherCoordinates(lat, lon) ? [{ name: city.name, region: city.adm1, country: city.country, lat, lon }] : [];
    });
  }) || [];
}
