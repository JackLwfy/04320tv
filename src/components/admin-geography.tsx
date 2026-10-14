'use client';

import { useId, useState } from 'react';
import type { AnalyticsGeography } from '@/lib/analytics-types';
import chinaMap from '@/lib/china-map.json';
import s from './admin-geography.module.css';

const metrics = [{ key: 'views', label: '浏览量', short: 'PV' }, { key: 'ips', label: '去重 IP', short: 'IP' }, { key: 'visitors', label: '访问设备', short: 'UV' }] as const;
const colors = ['#22382f', '#315647', '#45816a', '#70b496', '#b4ddbd'];
const number = (value: number) => value.toLocaleString('zh-CN');

export function AdminGeography({ data }: { data?: AnalyticsGeography }) {
  const [metric, setMetric] = useState<(typeof metrics)[number]>(metrics[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const id = useId().replace(/:/g, '');
  if (!data) return <section className={s.panel}><div className={s.heading}><h2>全国访问省份</h2><p>地区统计尚未就绪，启用采集后将在这里展示。</p></div></section>;
  const sorted = [...data.provinces].sort((a, b) => b[metric.key] - a[metric.key] || a.code.localeCompare(b.code));
  const ranking = sorted.filter(row => row[metric.key] > 0).slice(0, 8);
  const max = Math.max(1, ...sorted.map(row => row[metric.key]));
  const active = data.provinces.find(row => row.code === (hover || selected)) || ranking[0];
  const observed = data.provinces.filter(row => row[metric.key] > 0).length;
  const locatedViews = data.provinces.reduce((total, row) => total + row.views, 0);
  const coverage = data.total.views ? Math.min(100, locatedViews / data.total.views * 100) : 0;
  const color = (value: number) => value ? colors[Math.min(4, Math.floor(Math.log1p(value) / Math.log1p(max) * 4))] : '#273c30';
  const choose = (code: string) => setSelected(previous => previous === code ? null : code);
  const started = data.startedAt ? new Date(data.startedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : null;
  return <section className={s.panel} aria-label="全国访问省份统计">
    <div className={s.heading}><div><span className={s.eyebrow}>AUDIENCE ATLAS / CHINA</span><h2>观众从哪里来</h2><p>全国 34 个省级地区 · 随上方时间、设备与浏览器筛选更新</p></div><div className={s.metrics} role="group" aria-label="省份统计指标">{metrics.map(item => <button key={item.key} aria-pressed={metric.key === item.key} onClick={() => setMetric(item)}>{item.label}<span>{item.short}</span></button>)}</div></div>
    <div className={s.summary}><div><span>有访问的省级地区</span><strong>{observed}<small> / 34</small></strong></div><div><span>中国省份识别率 · 按 PV</span><strong>{coverage.toFixed(1)}<small>%</small></strong></div><div><span>当前指标 · 全部地区</span><strong>{number(data.total[metric.key])}<small>{metric.short}</small></strong></div></div>
    <div className={s.body}>
      <div className={s.mapWrap}>
        <div className={s.focus} aria-live="polite"><div><span>{active ? '省级地区' : '等待第一位观众'}</span><strong>{active?.name || '暂无省份访问数据'}</strong></div><div><strong>{active ? number(active[metric.key]) : '—'}</strong><span>{metric.label}</span></div></div>
        <svg className={s.map} viewBox="0 0 710 490" role="group" aria-label="中国省份访问分布图，可用 Tab 键选择省份；完整数值见下方数据表。">
          <defs><clipPath id={`${id}-main`}><rect x="0" y="0" width="710" height="454" /></clipPath><clipPath id={`${id}-sea`}><rect x="555" y="315" width="130" height="145" /></clipPath></defs>
          <g clipPath={`url(#${id}-main)`}>{chinaMap.regions.map(region => {
            const row = data.provinces.find(item => item.code === region.code);
            const value = row?.[metric.key] || 0;
            return <path key={region.code} d={region.path} fill={color(value)} className={`${s.region} ${active?.code === region.code ? s.selected : ''}`} tabIndex={0} role="button" aria-label={`${region.name}，${metric.label} ${number(value)}`} aria-pressed={selected === region.code} onMouseEnter={() => setHover(region.code)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(region.code)} onBlur={() => setHover(null)} onClick={() => choose(region.code)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(region.code); } }}><title>{`${region.name} · ${metric.label} ${number(value)}`}</title></path>;
          })}<path d={chinaMap.boundary.path} className={s.boundary} /></g>
          <rect x="547" y="306" width="146" height="163" rx="3" className={s.inset} />
          <g clipPath={`url(#${id}-sea)`} aria-hidden="true">{chinaMap.regions.map(region => <path key={region.code} d={region.seaPath} fill={color(data.provinces.find(item => item.code === region.code)?.[metric.key] || 0)} className={s.seaRegion} />)}<path d={chinaMap.boundary.seaPath} className={s.boundary} /></g>
          <text x="620" y="485" textAnchor="middle" className={s.mapLabel}>南海诸岛</text>
        </svg>
        <div className={s.legend}><span><i style={{ background: '#273c30' }} />无访问</span><span>低</span><div>{colors.map(item => <i key={item} style={{ background: item }} />)}</div><span>高 · 相对热度</span></div>
        <p className={s.mapSource}>图源：<a href={chinaMap.source} target="_blank" rel="noreferrer">阿里云 DataV</a> · 轮廓经简化，仅作访问统计示意</p>
      </div>
      <div className={s.rank}><div className={s.rankHeading}><h3>省份排行</h3><span>{metric.label} · TOP 8</span></div>{ranking.length ? <ol>{ranking.map((row, index) => <li key={row.code}><button aria-pressed={selected === row.code} onClick={() => choose(row.code)} onMouseEnter={() => setHover(row.code)} onMouseLeave={() => setHover(null)}><span className={s.rankNumber}>{String(index + 1).padStart(2, '0')}</span><span className={s.rankName}>{row.name}<span className={s.bar}><i style={{ width: `${row[metric.key] / max * 100}%` }} /></span></span><strong>{number(row[metric.key])}</strong></button></li>)}</ol> : <p className={s.empty}>所选条件下暂无可识别到省份的访问。后续真实访问完成采集后会自动展示。</p>}<div className={s.unmapped}>{[{ label: '境外访问', row: data.overseas }, { label: '中国 · 省份未知', row: data.unlocated }, { label: '地区未知', row: data.unknown }].map(item => <div key={item.label}><span>{item.label}</span><strong>{number(item.row[metric.key])}</strong></div>)}</div></div>
    </div>
    <div className={s.notes}><p>{started ? `地区采集自 ${started} 启用。` : '地区采集启用后开始积累。'}中国省份识别率 = 已识别中国省份的浏览量 ÷ 全部浏览量；境外及未知单列。</p><p>IP 归属地是近似位置，代理、VPN 或运营商出口可能影响结果。同一 IP 或设备跨省访问会在各省分别计数，总计按全局去重；UV 表示设备。</p></div>
    <details className={s.details}><summary>查看全国 34 个省级地区完整数据 <span>PV / IP / UV / 会话</span></summary><div className={s.tableScroll}><table><caption className={s.srOnly}>全国省级地区访问统计，按当前指标排序</caption><thead><tr><th scope="col">省级地区</th><th scope="col">浏览量 PV</th><th scope="col">去重 IP</th><th scope="col">访问设备 UV</th><th scope="col">会话数</th></tr></thead><tbody>{sorted.map(row => <tr key={row.code}><th scope="row">{row.name}</th><td>{number(row.views)}</td><td>{number(row.ips)}</td><td>{number(row.visitors)}</td><td>{number(row.sessions)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
