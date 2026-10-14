'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsReport, AnalyticsTrend, AnalyticsView, MetricFormat } from '@/lib/analytics-types';
import { analyticsDate, analyticsRange, formatMetric } from '@/lib/analytics-display';
import s from './admin-analytics.module.css';

const views: { id: AnalyticsView; label: string; description: string }[] = [
  { id: 'overview', label: '统计概览', description: '从一次访问，到一段真正开始的故事。' },
  { id: 'traffic', label: '访问分析', description: '了解观众从哪里来，何时回到这里。' },
  { id: 'search', label: '搜索需求', description: '每一个搜索词，都是一个等待回应的期待。' },
  { id: 'content', label: '内容热度', description: '看见被选择的故事，也看见持续观看的兴趣。' },
  { id: 'quality', label: '播放质量', description: '从搜索可达，到画面真正开始。' },
  { id: 'newsletter', label: '订阅转化', description: '关注每一步邀请，而不把受理误认为送达。' },
  { id: 'health', label: '采集运行', description: '数字值得相信，始于采集链路的可靠运行。' },
];
const trendMetrics: { key: Exclude<keyof AnalyticsTrend, 'date'>; label: string; format: MetricFormat }[] = [
  { key: 'visitors', label: '访问设备', format: 'number' }, { key: 'views', label: '浏览量', format: 'number' },
  { key: 'searches', label: '搜索次数', format: 'number' }, { key: 'starts', label: '成功起播', format: 'number' },
  { key: 'watchMs', label: '观看时长', format: 'duration' }, { key: 'failures', label: '失败次数', format: 'number' },
];
function timeLabel(value: string | null) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function Trend({ rows }: { rows: AnalyticsTrend[] }) {
  const [metric, setMetric] = useState(trendMetrics[0]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map(row => row[metric.key]));
  const x = (index: number) => 72 + (rows.length === 1 ? 410 : index / Math.max(1, rows.length - 1) * 820);
  const y = (value: number) => 218 - value / max * 170;
  const points = rows.map((row, index) => `${x(index)},${y(row[metric.key])}`).join(' ');
  const selected = hover === null ? null : rows[hover];
  return <section className={s.panel} aria-label="每日趋势">
    <div className={s.panelHeading}><div><span className={s.eyebrow}>THE DAILY PICTURE</span><h2>每日趋势</h2></div><label className={s.chartSelect}>趋势指标<select value={metric.key} onChange={event => { setMetric(trendMetrics.find(item => item.key === event.target.value)!); setHover(null); }}>{trendMetrics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
    {!rows.length ? <p className={s.empty}>所选时间内暂无趋势数据。</p> : <>
      <div className={s.chart}><svg viewBox="0 0 940 270" role="img" aria-label={`${metric.label}每日趋势；下方提供完整数据表。`}>
        {[0, 0.5, 1].map(scale => <g key={scale}><line x1="72" x2="892" y1={y(max * scale)} y2={y(max * scale)} className={s.gridLine} /><text x="60" y={y(max * scale) + 4} textAnchor="end">{formatMetric(max * scale, metric.format)}</text></g>)}
        <polygon points={`72,218 ${points} ${x(rows.length - 1)},218`} className={s.chartArea} />
        <polyline points={points} className={s.chartLine} />
        {rows.map((row, index) => <g key={row.date}><circle cx={x(index)} cy={y(row[metric.key])} r={rows.length > 60 ? 2 : 3} className={s.chartDot} /><rect x={x(index) - Math.min(15, 410 / rows.length)} y="35" width={Math.min(30, 820 / rows.length)} height="190" fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}><title>{row.date} · {metric.label}：{formatMetric(row[metric.key], metric.format)}</title></rect></g>)}
        <text x="72" y="250">{rows[0].date}</text><text x="892" y="250" textAnchor="end">{rows[rows.length - 1].date}</text>
      </svg></div>
      <p className={s.chartCaption}>{selected ? `${selected.date} · ${metric.label} ${formatMetric(selected[metric.key], metric.format)}` : '按北京时间逐日统计 · 悬停查看数值，或展开下方数据表。'}</p>
      <details className={s.details}><summary>查看完整趋势数据</summary><div className={s.tableScroll}><table><caption className={s.srOnly}>每日趋势数据</caption><thead><tr><th scope="col">日期</th>{trendMetrics.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}</th>{trendMetrics.map(item => <td key={item.key}>{formatMetric(row[item.key], item.format)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

export function AdminAnalytics() {
  const [view, setView] = useState<AnalyticsView>('overview');
  const [preset, setPreset] = useState('7');
  const [range, setRange] = useState(() => analyticsRange(7));
  const [media, setMedia] = useState('all');
  const [source, setSource] = useState('');
  const [device, setDevice] = useState('all');
  const [browser, setBrowser] = useState('all');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [sources, setSources] = useState<AnalyticsReport['sources']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportRequest = useRef<AbortController | null>(null);
  const hasMedia = ['overview', 'content', 'quality'].includes(view);
  const hasSource = ['search', 'content', 'quality'].includes(view);
  const hasAudience = view !== 'health';
  const params = useMemo(() => new URLSearchParams({ view, ...range, media: hasMedia ? media : 'all', source: hasSource ? source : '', device: hasAudience ? device : 'all', browser: hasAudience ? browser : 'all', page: String(page) }).toString(), [view, range, hasMedia, media, hasSource, source, hasAudience, device, browser, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('请求超时，请重试。')), 30000);
    let active = true;
    setLoading(true); setError(''); setReport(null); setExportError('');
    exportRequest.current?.abort();
    fetch(`/api/admin/analytics?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 401) throw new Error('管理员会话已过期，请退出后重新登录。');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '统计读取失败，请稍后重试。');
      if (active) { setReport(data as AnalyticsReport); setSources(data.sources); }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法连接统计服务，请重试。'); }).finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [params, refresh]);
  useEffect(() => () => exportRequest.current?.abort(), []);

  async function download() {
    const controller = new AbortController(); exportRequest.current = controller;
    setExporting(true); setExportError('');
    const timeout = setTimeout(() => controller.abort(new Error('导出超时，请重试。')), 30000);
    try {
      const response = await fetch(`/api/admin/analytics?${params}&format=csv`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (response.status === 401) throw new Error('管理员会话已过期，请重新登录后导出。');
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '导出失败。'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `04320-${view}-${range.from}-${range.to}-page${page}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { if (!controller.signal.aborted || controller.signal.reason?.message === '导出超时，请重试。') setExportError(controller.signal.aborted ? controller.signal.reason.message : reason instanceof Error ? reason.message : '导出失败。'); }
    finally { clearTimeout(timeout); setExporting(false); }
  }
  const maxPage = Math.max(1, ...(report?.tables.map(table => Math.ceil(table.total / table.pageSize)) || []));
  const importantNotices = report?.notices.filter(notice => notice.startsWith('统计从 ') || notice.includes('隔离测试数据')) || [];
  const otherNotices = report?.notices.filter(notice => !importantNotices.includes(notice)) || [];

  return <div className={s.analytics}>
    <nav className={s.tabs} aria-label="统计视图">{views.map(item => <button key={item.id} aria-pressed={view === item.id} className={view === item.id ? s.activeTab : ''} onClick={() => { setView(item.id); setPage(1); setSource(''); }}>{item.label}</button>)}</nav>
    <div className={s.intro}><p>{views.find(item => item.id === view)?.description}</p><span>北京时间 · {view === 'overview' ? '概览最多 13 个月' : '明细最多 90 天'}</span></div>
    <section className={s.filters} aria-label="统计筛选">
      <div className={s.filterRow}><div className={s.presets}>{[['1', '今日'], ['yesterday', '昨日'], ['7', '近 7 天'], ['30', '近 30 天'], ['custom', '自定义']].map(([id, label]) => <button key={id} aria-pressed={preset === id} onClick={() => { setPreset(id); setPage(1); if (id !== 'custom') setRange(analyticsRange(id === 'yesterday' ? 1 : Number(id), id === 'yesterday')); }}>{label}</button>)}</div><div className={s.actions}><button onClick={() => setRefresh(value => value + 1)} disabled={loading}>刷新</button><button className={s.export} onClick={download} disabled={loading || !report || exporting}>{exporting ? '正在导出…' : '导出本页 CSV ↗'}</button></div></div>
      <div className={s.filterRow}><div className={s.selects}><label>开始日期<input type="date" value={range.from} max={range.to || analyticsDate()} onChange={event => { setRange({ ...range, from: event.target.value }); setPreset('custom'); setPage(1); }} /></label><label>结束日期<input type="date" value={range.to} min={range.from} max={analyticsDate()} onChange={event => { setRange({ ...range, to: event.target.value }); setPreset('custom'); setPage(1); }} /></label>
        {hasMedia && <label>播放类型<select value={media} onChange={event => { setMedia(event.target.value); setPage(1); }}><option value="all">全部类型</option><option value="vod">点播</option><option value="live">直播</option></select></label>}
        {hasSource && <label>片源<select value={source} onChange={event => { setSource(event.target.value); setPage(1); }}><option value="">全部片源</option>{sources.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>}
        {hasAudience && <><label>设备<select value={device} onChange={event => { setDevice(event.target.value); setPage(1); }}><option value="all">全部设备</option><option value="mobile">手机</option><option value="desktop">电脑</option><option value="tablet">平板</option></select></label><label>浏览器<select value={browser} onChange={event => { setBrowser(event.target.value); setPage(1); }}>{['all', 'Chrome', 'Safari', 'Edge', 'Firefox', 'Other'].map(item => <option value={item} key={item}>{item === 'all' ? '全部浏览器' : item === 'Other' ? '其他' : item}</option>)}</select></label></>}
      </div></div>
    </section>
    {exportError && <p className={s.error} role="alert">{exportError}</p>}
    <div aria-live="polite" aria-busy={loading}>
      {loading && <div className={s.loading} role="status"><span className={s.loadingLine} /><span>正在读取统计数据…</span><small>连接真实数据，稍候片刻。</small></div>}
      {error && <section className={s.errorPanel} role="alert"><span className={s.eyebrow}>DATA UNAVAILABLE</span><h2>暂时无法读取统计</h2><p>{error}</p><button onClick={() => setRefresh(value => value + 1)}>重新读取</button></section>}
      {report && !loading && <>
        <div className={s.status}><span className={report.enabled ? s.enabled : s.disabled}>{report.enabled ? '统计采集已启用' : '统计采集未启用'}</span><span>最后入库：{timeLabel(report.lastEventAt)}</span><span>报表更新：{timeLabel(report.generatedAt)}</span></div>
        {importantNotices.length > 0 && <aside className={s.importantNotices} aria-label="采集范围">{importantNotices.map((notice, index) => <p key={index}>{notice}</p>)}</aside>}
        <section className={s.cards} aria-label="关键指标">{report.cards.map((card, index) => <article className={s.card} key={card.key}><span className={s.cardIndex}>{String(index + 1).padStart(2, '0')}</span><h2>{card.label}</h2><strong>{formatMetric(card.value, card.format)}</strong>{card.previous !== undefined && <span className={s.comparison}>上一等长时段：{formatMetric(card.previous, card.format)}</span>}<p>{card.help}</p></article>)}</section>
        {otherNotices.length > 0 && <details key={view} className={s.notices}><summary>数据口径与说明 <span>{otherNotices.length} 项 · 展开查看</span></summary><div>{otherNotices.map((notice, index) => <p key={index}>{notice}</p>)}</div></details>}
        {view !== 'health' && <Trend rows={report.trend} />}
        <div className={s.reports}>{report.tables.map(table => <section key={table.key} className={s.panel}><div className={s.panelHeading}><div><span className={s.eyebrow}>A CLOSER LOOK</span><h2>{table.title}</h2>{table.help && <p>{table.help}</p>}</div><span className={s.rowCount}>{table.total.toLocaleString('zh-CN')} 条</span></div><div className={s.tableScroll}><table><caption className={s.srOnly}>{table.title} · 第 {table.page} 页</caption><thead><tr>{table.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map(column => <td key={column.key}>{formatMetric(row[column.key] ?? null, column.format)}</td>)}</tr>)}</tbody></table>{!table.rows.length && <p className={s.empty}>{table.total > 0 ? '此表在当前页没有记录，请查看前面的页码。' : '所选条件下暂无记录。'}</p>}</div></section>)}</div>
        {report.tables.length > 0 && <div className={s.pagination}><p>各明细表使用同一页码；CSV 导出本页各表数据。</p><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="上一页">← 上一页</button><span>第 {page} / {maxPage} 页</span><button disabled={page >= maxPage} onClick={() => setPage(value => value + 1)} aria-label="下一页">下一页 →</button></div></div>}
        <p className={s.footerNote}>匿名设备不等同于真实人数。客户端事件可能漏报；接口可达、实际起播与邮件送达分别统计。</p>
      </>}
    </div>
  </div>;
}
