'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WeatherCity, WeatherReading } from '@/lib/weather';

const preferenceKey = '04320-weather-preference';
const cacheKey = '04320-weather-cache-open-meteo';
type Preference = 'auto' | 'off' | WeatherCity;
export function validCity(value: unknown): value is WeatherCity {
  if (!value || typeof value !== 'object') return false;
  const city = value as WeatherCity;
  return typeof city.name === 'string' && city.name.length > 0 && city.name.length <= 100 && typeof city.region === 'string' && typeof city.country === 'string' && Number.isFinite(city.lat) && Math.abs(city.lat) <= 90 && Number.isFinite(city.lon) && Math.abs(city.lon) <= 180;
}
export function freshWeather(value: unknown, now = Date.now()): value is WeatherReading {
  if (!value || typeof value !== 'object') return false;
  const w = value as WeatherReading;
  return Number.isFinite(w.temp) && Math.abs(w.temp) <= 100 && typeof w.text === 'string' && w.text.length <= 100 && ['rain', 'snow', 'none'].includes(w.kind) && Number.isFinite(w.fetchedAt) && w.fetchedAt <= now + 60000 && w.expiresAt > now && w.expiresAt <= w.fetchedAt + 1800000 && Array.isArray(w.attributions) && w.attributions.length > 0 && w.attributions.every(text => typeof text === 'string' && text.length <= 500);
}
async function json(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('天气暂不可用');
  return response.json();
}
async function chineseCity(city: WeatherCity, signal: AbortSignal): Promise<WeatherCity> {
  if (/\p{Script=Han}/u.test(city.name) && !/[a-z]/i.test(city.name)) return city;
  try {
    const data = await json(`/api/weather/cities?q=${encodeURIComponent(city.name)}`, signal);
    const distance = (candidate: WeatherCity) => (candidate.lat - city.lat) ** 2 + ((candidate.lon - city.lon) * Math.cos(city.lat * Math.PI / 180)) ** 2;
    const candidates: WeatherCity[] = Array.isArray(data.cities) ? data.cities.filter(validCity).filter((candidate: WeatherCity) => /\p{Script=Han}/u.test(candidate.name) && !/[a-z]/i.test(candidate.name) && distance(candidate) <= 1) : [];
    const nearest = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (nearest) return { ...city, name: nearest.name, region: nearest.region, country: nearest.country };
  } catch { /* 名称查询失败仍可按原坐标获取天气。 */ }
  return { ...city, name: '所在城市', region: '', country: '中国' };
}
export function useHomeWeather(enabled: boolean, ready: boolean) {
  const [preference, setPreference] = useState<Preference>('auto');
  const [city, setCity] = useState<WeatherCity | null>(null);
  const [weather, setWeather] = useState<WeatherReading | null>(null);
  const [kind, setKind] = useState<WeatherReading['kind']>('none');
  const [pending, setPending] = useState(enabled);
  const [message, setMessage] = useState('正在感知此刻天气');
  const [revision, setRevision] = useState(0);
  const first = useRef(true);
  const initialWindow = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { const deadline = setTimeout(() => { initialWindow.current = false; setPending(false); }, 500); return () => clearTimeout(deadline); }, []);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(preferenceKey) || '"auto"'); if (saved === 'off' || validCity(saved)) setPreference(saved); } catch { /* 隐私模式不持久化。 */ }
    setHydrated(true);
  }, []);
  const choose = useCallback((next: Preference) => {
    first.current = false;
    setPreference(next); setWeather(null); setKind('none'); setRevision(n => n + 1);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); sessionStorage.removeItem(cacheKey); } catch { /* 当前页面仍可使用。 */ }
  }, []);
  useEffect(() => {
    if (!enabled || preference === 'off') { setPending(false); setWeather(null); setKind('none'); return; }
    if (!ready || !hydrated) return;
    let stopped = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let epoch = 0;
    async function refresh() {
      controller?.abort(); controller = new AbortController();
      const activeController = controller;
      const request = ++epoch;
      const timeout = setTimeout(() => activeController.abort(), 4500);
      const initial = first.current;
      try {
        let location: WeatherCity | null = typeof preference === 'object' ? preference : null;
        let reading: WeatherReading | null = null;
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
          if (cached && JSON.stringify(cached.preference) === JSON.stringify(preference) && validCity(cached.city) && freshWeather(cached.weather)) { location = cached.city; reading = cached.weather; }
        } catch { /* 忽略过期或无效缓存。 */ }
        if (!location) { const geo = await json('/api/weather/location', controller.signal); if (validCity(geo.city)) location = geo.city; }
        if (!location) throw new Error('未能识别城市，可手动选择');
        const [localized, result] = await Promise.all([
          chineseCity(location, activeController.signal),
          reading ? Promise.resolve({ weather: reading }) : json(`/api/weather/current?lat=${location.lat.toFixed(2)}&lon=${location.lon.toFixed(2)}`, activeController.signal),
        ]);
        location = localized;
        reading = freshWeather(result.weather) ? result.weather : null;
        if (!reading) throw new Error('天气暂不可用，继续欣赏此刻光影');
        if (stopped || epoch !== request) return;
        setCity(location); setWeather(reading); setMessage('');
        // 首次慢响应只更新天气文字，避免刚下载时段图又下载天气图。
        if (!initial || initialWindow.current) setKind(reading.kind);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ preference, city: location, weather: reading })); } catch { /* 无缓存也可使用。 */ }
        clearTimeout(timer); timer = setTimeout(refresh, Math.max(1000, reading.expiresAt - Date.now()));
      } catch (error) {
        if (stopped || epoch !== request) return;
        setWeather(null); setKind('none'); setMessage(error instanceof Error && error.name !== 'AbortError' ? error.message : '天气暂不可用，稍后自动重试');
        clearTimeout(timer); timer = setTimeout(refresh, 300000);
      } finally {
        clearTimeout(timeout);
        if (!stopped && epoch === request) { first.current = false; setPending(false); }
      }
    }
    function visible() { if (document.visibilityState === 'visible') void refresh(); }
    void refresh(); document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [enabled, ready, preference, revision, hydrated]);
  return { city, weather, kind, pending, message, preference, choose };
}

export type HomeWeather = ReturnType<typeof useHomeWeather>;
