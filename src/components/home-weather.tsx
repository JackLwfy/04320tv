'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WeatherCity } from '@/lib/weather';
import { validCity, type HomeWeather } from './use-home-weather';

function attributionUrl(text: string) {
  try { const url = new URL(text); return url.protocol === 'https:' && !url.username && !url.password ? url : null; } catch { return null; }
}

export function HomeWeatherControl({ state }: { state: HomeWeather }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherCity[]>([]);
  const [status, setStatus] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function search(event: FormEvent) {
    event.preventDefault(); active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setResults([]); setStatus('正在查找城市…');
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`/api/weather/cities?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const cities = Array.isArray(data.cities) ? data.cities.filter(validCity).slice(0, 5) : [];
      if (active.current !== controller) return;
      setResults(cities); setStatus(cities.length ? '选择下方城市' : '未找到城市，请补充省份或换个名称');
    } catch { if (active.current === controller) setStatus('暂时无法查找，请稍后再试'); }
    finally { clearTimeout(timeout); }
  }
  const off = state.preference === 'off';
  return <div className="cinema-weather">
    <button type="button" className="cinema-weather-trigger" aria-expanded={open} aria-controls="home-weather-panel" onClick={() => setOpen(!open)}>
      <span className="cinema-weather-dot" aria-hidden="true" />
      {off ? '天气氛围已关闭' : state.weather ? `${state.city?.name} · ${state.weather.text} ${Math.round(state.weather.temp)}°` : state.message}
      <span className="cinema-weather-action">{open ? '收起' : '城市与天气'} <span aria-hidden="true">↗</span></span>
    </button>
    {state.weather && <small className="cinema-weather-source">{state.weather.attributions.map((text, index) => { const url = attributionUrl(text); return <span key={index}>{index ? ' · ' : ''}{url ? <a href={url.href} target="_blank" rel="noopener noreferrer">{url.hostname}</a> : text}</span>; })}</small>}
    {open && <section id="home-weather-panel" className="cinema-weather-panel" aria-label="城市与天气设置">
      <div className="cinema-weather-heading"><div><small>WEATHER / YOUR MOMENT</small><h2>让故事，遇见此刻。</h2></div><button type="button" aria-label="关闭天气设置" onClick={() => setOpen(false)}>×</button></div>
      <p>按大致城市切换雨雪光影，无需精确定位。自动识别不准确时，可以自己选城。</p>
      <form onSubmit={search}><label htmlFor="weather-city">城市名称</label><div className="cinema-weather-search"><input id="weather-city" value={query} onChange={event => setQuery(event.target.value)} maxLength={60} placeholder="例如：杭州" autoComplete="off" /><button type="submit" disabled={query.trim().length < 2}>查找</button></div></form>
      <p role="status">{status}</p>
      {results.length > 0 && <ul>{results.map((city, index) => <li key={`${city.lat},${city.lon},${index}`}><button type="button" onClick={() => { state.choose(city); setResults([]); setStatus('已选择城市，正在更新天气'); }}>{city.name}<span>{city.region} · {city.country}</span></button></li>)}</ul>}
      {results.length > 0 && <p className="cinema-weather-credit">城市数据：<a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a></p>}
      <div className="cinema-weather-options"><button type="button" onClick={() => { state.choose('auto'); setStatus('已恢复自动识别'); }}>恢复自动识别</button><button type="button" onClick={() => { state.choose(off ? 'auto' : 'off'); setStatus(''); }}>{off ? '开启天气氛围' : '关闭天气氛围'}</button></div>
      {state.weather && <p className="cinema-weather-credit">获取于 {new Date(state.weather.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 每 30 分钟更新</p>}
    </section>}
  </div>;
}
