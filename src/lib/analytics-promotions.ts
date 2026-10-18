import crypto from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';
import { parseReportFilter, percent, type ReportFilter } from './analytics-report';
import { businessDay, DAY_MS, sqlDate } from './analytics-validation';
import { PROVINCES } from './analytics-geography';

export interface PromotionLink { id: string; name: string; channel: string; activity: string; placement: string; creative: string; notes: string; landingPath: string; archived: boolean; createdAt: string; updatedAt: string; url: string }
export interface PromotionMetrics { arrivals: number; visitors: number; views: number; newVisitors: number; searchDevices: number; playingDevices: number; playRate: number | null; watchMs: number; newsletterDevices: number; effectiveDevices: number; effectiveRate: number | null; newsletterRate: number | null }
export interface PromotionFilter extends ReportFilter { channel: string; activity: string; archived: string; id: string; sort: string; q: string }
export const PROMOTION_PAGE_SIZE = 20;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sorts: Record<string, string> = { arrivals: 'arrivals', visitors: 'visitors', playRate: 'playRate', watchMs: 'watchMs', newsletterDevices: 'newsletterDevices' };
function string(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}无效。`);
  const result = value.trim(); if (required && !result) throw new Error(`请填写${label}。`); return result;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效。'); return value as Record<string, unknown>; }
export function promotionOrigin() {
  const origin = new URL(process.env.ADMIN_ORIGIN || '');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('站点地址尚未正确配置。');
  return origin.origin;
}
export function promotionLandingPath(value: unknown) {
  const path = string(value, '落地页面', 1000, true);
  if (!path.startsWith('/') || path.startsWith('//') || /\\/.test(path)) throw new Error('落地页面必须是站内路径。');
  const url = new URL(path, promotionOrigin());
  let decoded: string; try { decoded = decodeURIComponent(url.pathname); } catch { throw new Error('落地页面编码无效。'); }
  if (url.origin !== promotionOrigin() || decoded.startsWith('//') || /^\/(admin|api)(\/|$)/i.test(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded)) throw new Error('落地页面不能指向管理后台、接口或站外。');
  url.searchParams.delete('promo');
  return url.pathname + url.search + url.hash;
}
export function parsePromotionCreate(value: unknown) {
  const body = object(value);
  const result = { name: string(body.name, '链接名称', 120, true), channel: string(body.channel, '渠道', 80, true), activity: string(body.activity ?? '', '活动', 120), placement: string(body.placement ?? '', '投放位置', 120), creative: string(body.creative ?? '', '素材版本', 120), notes: string(body.notes ?? '', '备注', 1000), landingPath: promotionLandingPath(body.landingPath) };
  return result;
}
export function parsePromotionUpdate(value: unknown) {
  const body = object(value); const id = string(body.id, '链接编号', 36, true);
  if (!UUID.test(id) || Object.keys(body).some(key => !['id', 'name', 'notes', 'archived'].includes(key))) throw new Error('仅可修改链接名称、备注和归档状态。');
  const result: { id: string; name?: string; notes?: string; archived?: boolean } = { id };
  if ('name' in body) result.name = string(body.name, '链接名称', 120, true);
  if ('notes' in body) result.notes = string(body.notes, '备注', 1000);
  if ('archived' in body) { if (typeof body.archived !== 'boolean') throw new Error('归档状态无效。'); result.archived = body.archived; }
  if (Object.keys(result).length === 1) throw new Error('没有需要修改的内容。');
  return result;
}
export function parsePromotionFilter(url: URL, now = Date.now()): PromotionFilter {
  const clean = new URL(url); clean.searchParams.set('view', 'overview');
  const f = parseReportFilter(clean, now); const p = url.searchParams;
  if (f.from < businessDay(now - 89 * DAY_MS)) throw new Error('推广链接明细仅保留最近90天。');
  const id = p.get('id') || ''; const archived = p.get('archived') || '0'; const sort = p.get('sort') || 'arrivals';
  if ((id && !UUID.test(id)) || !['0', '1', 'all'].includes(archived) || !sorts[sort]) throw new Error('推广链接筛选无效。');
  return { ...f, channel: string(p.get('channel') || '', '渠道', 80), activity: string(p.get('activity') || '', '活动', 120), q: string(p.get('q') || '', '搜索内容', 120), archived, id, sort };
}
function link(row: RowDataPacket): PromotionLink {
  const url = new URL(String(row.landing_path), promotionOrigin()); url.searchParams.set('promo', String(row.id));
  return { id: row.id, name: row.name, channel: row.channel, activity: row.activity, placement: row.placement, creative: row.creative, notes: row.notes, landingPath: row.landing_path, archived: !!row.archived, createdAt: String(row.created_at), updatedAt: String(row.updated_at), url: url.href };
}
async function rows(c: PoolConnection, sql: string, values: unknown[] = []) {
  const [data] = await c.query<RowDataPacket[]>({ sql: `SET STATEMENT max_statement_time=8 FOR ${sql}`, timeout: 9500 }, values); return data;
}
export async function createPromotion(value: unknown) {
  const body = parsePromotionCreate(value); const id = crypto.randomUUID(); const c = await analyticsPool().getConnection();
  try {
    await c.execute('INSERT INTO analytics_promotion_links (id,name,channel,activity,placement,creative,notes,landing_path) VALUES (?,?,?,?,?,?,?,?)', [id, body.name, body.channel, body.activity, body.placement, body.creative, body.notes, body.landingPath]);
    return link((await rows(c, 'SELECT * FROM analytics_promotion_links WHERE id=?', [id]))[0]);
  } finally { c.release(); }
}
export async function updatePromotion(value: unknown) {
  const body = parsePromotionUpdate(value); const c = await analyticsPool().getConnection();
  try {
    const fields: string[] = []; const values: unknown[] = [];
    for (const key of ['name', 'notes', 'archived'] as const) if (body[key] !== undefined) { fields.push(`${key}=?`); values.push(body[key]); }
    await c.query(`UPDATE analytics_promotion_links SET ${fields.join(',')},updated_at=CURRENT_TIMESTAMP(3) WHERE id=?`, [...values, body.id]);
    const found = (await rows(c, 'SELECT * FROM analytics_promotion_links WHERE id=?', [body.id]))[0];
    if (!found) return null; return link(found);
  } finally { c.release(); }
}

// Build one cohort per visit; event/playback joins include owner and test scope so retries and forged IDs cannot inflate attribution.
export function promotionCohort(f: PromotionFilter) {
  const clauses = ['v.is_test=?', 'v.entered_at>=?', 'v.entered_at<?'];
  const values: unknown[] = [f.test ? 1 : 0, sqlDate(Date.parse(`${f.from}T00:00:00+08:00`)), sqlDate(Date.parse(`${f.to}T00:00:00+08:00`) + DAY_MS)];
  for (const [column, value] of [['device', f.device], ['browser', f.browser]] as const) if (value !== 'all') { clauses.push(`v.${column}=?`); values.push(value); }
  const meta: string[] = []; const metaValues: unknown[] = [];
  for (const [column, value] of [['channel', f.channel], ['activity', f.activity], ['id', f.id]] as const) if (value) { meta.push(`l.${column}=?`); metaValues.push(value); }
  // A detail remains readable after archive regardless of the list's default active filter.
  if (!f.id && f.archived !== 'all') { meta.push('l.archived=?'); metaValues.push(Number(f.archived)); }
  if (f.q) { meta.push('(LOCATE(?,l.name)>0 OR LOCATE(?,l.channel)>0 OR LOCATE(?,l.placement)>0)'); metaValues.push(f.q, f.q, f.q); }
  const links = `SELECT l.* FROM analytics_promotion_links l${meta.length ? ' WHERE ' + meta.join(' AND ') : ''}`;
  const sql = `WITH selected_links AS (${links}), cohort AS (SELECT v.* FROM analytics_promotion_visits v JOIN selected_links l ON l.id=v.link_id WHERE ${clauses.join(' AND ')}),
    ev AS (SELECT v.visit_id,SUM(e.kind='page_view') views,MAX(e.kind='search') searched,MAX(e.kind='newsletter_accepted') subscribed FROM cohort v JOIN analytics_events e ON e.promotion_visit_id=v.visit_id AND e.promotion_id=v.link_id AND e.visitor_id=v.visitor_id AND e.is_test=v.is_test GROUP BY v.visit_id),
    pl AS (SELECT v.visit_id,MAX(p.first_frame_ms IS NOT NULL) played,SUM(GREATEST(p.played_ms-p.hidden_played_ms,0)) watch_ms FROM cohort v JOIN analytics_playback p ON p.promotion_visit_id=v.visit_id AND p.promotion_id=v.link_id AND p.visitor_id=v.visitor_id AND p.is_test=v.is_test GROUP BY v.visit_id),
    facts AS (SELECT v.*,COALESCE(ev.views,0) views,COALESCE(ev.searched,0) searched,COALESCE(ev.subscribed,0) subscribed,COALESCE(pl.played,0) played,COALESCE(pl.watch_ms,0) watch_ms,COALESCE(a.first_seen=v.entered_at,0) is_new FROM cohort v LEFT JOIN ev ON ev.visit_id=v.visit_id LEFT JOIN pl ON pl.visit_id=v.visit_id LEFT JOIN analytics_visitors a ON a.visitor_id=v.visitor_id AND a.is_test=v.is_test)`;
  return { sql, values: [...metaValues, ...values] };
}
const aggregate = `COUNT(*) arrivals,COUNT(DISTINCT visitor_id) visitors,COALESCE(SUM(views),0) views,COUNT(DISTINCT CASE WHEN is_new THEN visitor_id END) newVisitors,COUNT(DISTINCT CASE WHEN searched THEN visitor_id END) searchDevices,COUNT(DISTINCT CASE WHEN played THEN visitor_id END) playingDevices,COALESCE(SUM(watch_ms),0) watchMs,COUNT(DISTINCT CASE WHEN subscribed THEN visitor_id END) newsletterDevices,COUNT(DISTINCT CASE WHEN watch_ms>=60000 THEN visitor_id END) effectiveDevices`;
function metrics(row: RowDataPacket | undefined): PromotionMetrics {
  const m = Object.fromEntries(['arrivals', 'visitors', 'views', 'newVisitors', 'searchDevices', 'playingDevices', 'watchMs', 'newsletterDevices', 'effectiveDevices'].map(key => [key, Number(row?.[key] || 0)])) as unknown as PromotionMetrics;
  return { ...m, playRate: percent(m.playingDevices, m.visitors), effectiveRate: percent(m.effectiveDevices, m.visitors), newsletterRate: percent(m.newsletterDevices, m.visitors) };
}
export async function promotionReport(f: PromotionFilter, csv = false) {
  const c = await analyticsPool().getConnection();
  try {
    await c.beginTransaction();
    const q = promotionCohort(f);
    const summary = metrics((await rows(c, `${q.sql} SELECT ${aggregate} FROM facts`, q.values))[0]);
    const grouped = `${q.sql}, grouped AS (SELECT link_id,${aggregate} FROM facts GROUP BY link_id) SELECT l.*,${['arrivals', 'visitors', 'views', 'newVisitors', 'searchDevices', 'playingDevices', 'watchMs', 'newsletterDevices', 'effectiveDevices'].map(k => `COALESCE(g.${k},0) ${k}`).join(',')},CASE WHEN g.visitors>0 THEN g.playingDevices/g.visitors*100 ELSE NULL END playRate FROM selected_links l LEFT JOIN grouped g ON g.link_id=l.id ORDER BY ${sorts[f.sort]} DESC,l.created_at DESC,l.id`;
    const data = await rows(c, `${grouped} LIMIT ? OFFSET ?`, [...q.values, csv ? 10001 : PROMOTION_PAGE_SIZE, csv ? 0 : (f.page - 1) * PROMOTION_PAGE_SIZE]);
    if (csv && data.length > 10000) throw new Error('导出最多支持10000条链接，请缩小筛选范围。');
    const total = Number((await rows(c, `${q.sql} SELECT COUNT(*) total FROM selected_links`, q.values))[0].total);
    const dimensions = await rows(c, 'SELECT DISTINCT channel,activity FROM analytics_promotion_links ORDER BY channel,activity');
    const daily = await rows(c, `${q.sql} SELECT DATE(DATE_ADD(entered_at,INTERVAL 8 HOUR)) date,${aggregate} FROM facts GROUP BY date ORDER BY date`, q.values);
    const report = { from: f.from, to: f.to, generatedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', summary, trend: promotionTrend(f,daily), notices: ['推广明细仅保留最近90天；功能启用前未采集的来源不能回填。','按到站日期选择推广访问，并归属该次访问后续行为；跨午夜行为计入到站日。','设备按匿名浏览器标识去重，不等于人数；新设备指可识别记录中首次出现（访客记录保留400天）；转发后仍归原推广链接。','观看时长为前台实际播放，单次推广访问累计60秒计为有效观看；搜索、内容榜各展示前50项，地区前100项。',...(f.test ? ['当前为隔离测试数据，不计入正式报表。'] : [])], links: data.map(r => ({ ...link(r), ...metrics(r) })), total, page: f.page, pageSize: PROMOTION_PAGE_SIZE, channels: [...new Set(dimensions.map(r => String(r.channel)))], activities: [...new Set(dimensions.map(r => String(r.activity)).filter(Boolean))], detail: undefined as Awaited<ReturnType<typeof promotionDetail>> | undefined };
    if (f.id) { const found = data[0] || (await rows(c, `${q.sql} SELECT * FROM selected_links`, q.values))[0]; if (found) report.detail = await promotionDetail(c, q, link(found), f); }
    await c.commit();
    return report;
  } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
}
function promotionTrend(f: PromotionFilter, daily: RowDataPacket[]) {
  const trend = [];
  for (let day = Date.parse(f.from); day <= Date.parse(f.to); day += DAY_MS) { const date = new Date(day).toISOString().slice(0, 10); trend.push({ date, ...metrics(daily.find(r => String(r.date) === date)) }); }
  return trend;
}
async function promotionDetail(c: PoolConnection, q: { sql: string; values: unknown[] }, item: PromotionLink, f: PromotionFilter) {
  const daily = await rows(c, `${q.sql} SELECT DATE(DATE_ADD(entered_at,INTERVAL 8 HOUR)) date,${aggregate} FROM facts GROUP BY date ORDER BY date`, q.values);
  const trend = promotionTrend(f,daily);
  const events = `FROM cohort v JOIN analytics_events e ON e.promotion_visit_id=v.visit_id AND e.promotion_id=v.link_id AND e.visitor_id=v.visitor_id AND e.is_test=v.is_test`;
  const searches = await rows(c, `${q.sql} SELECT e.query_text query,COUNT(*) searches,COUNT(DISTINCT v.visitor_id) devices,SUM(e.status='empty') emptyResults ${events} WHERE e.kind='search' GROUP BY e.query_text ORDER BY searches DESC,e.query_text LIMIT 50`, q.values);
  const content = await rows(c, `${q.sql} SELECT p.title,p.media,p.source_key sourceKey,MAX(p.source_name) sourceName,p.vod_id vodId,COUNT(DISTINCT CASE WHEN p.first_frame_ms IS NOT NULL THEN v.visitor_id END) playingDevices,SUM(GREATEST(p.played_ms-p.hidden_played_ms,0)) watchMs,SUM(p.status IN ('error','timeout')) failures FROM cohort v JOIN analytics_playback p ON p.promotion_visit_id=v.visit_id AND p.promotion_id=v.link_id AND p.visitor_id=v.visitor_id AND p.is_test=v.is_test GROUP BY p.source_key,p.vod_id,p.title,p.media ORDER BY watchMs DESC,p.title,p.source_key,p.vod_id LIMIT 50`, q.values);
  const devices = await rows(c, `${q.sql} SELECT device,COUNT(DISTINCT visitor_id) visitors FROM cohort GROUP BY device ORDER BY visitors DESC`, q.values);
  const browsers = await rows(c, `${q.sql} SELECT browser,COUNT(DISTINCT visitor_id) visitors FROM cohort GROUP BY browser ORDER BY visitors DESC`, q.values);
  const regions = await rows(c, `${q.sql} SELECT country,province,city,COUNT(DISTINCT visitor_id) visitors FROM cohort GROUP BY country,province,city ORDER BY visitors DESC,country,province,city LIMIT 100`, q.values);
  const newsletter = (await rows(c, `${q.sql} SELECT COUNT(DISTINCT CASE WHEN e.kind='newsletter_impression' THEN v.visitor_id END) impressionDevices,COUNT(DISTINCT CASE WHEN e.kind='newsletter_submit' THEN v.visitor_id END) submitDevices,COUNT(DISTINCT CASE WHEN e.kind='newsletter_accepted' THEN v.visitor_id END) acceptedDevices,COUNT(DISTINCT CASE WHEN e.kind='newsletter_error' THEN v.visitor_id END) errorDevices ${events}`, q.values))[0];
  return {
    link: item, trend,
    searches: searches.map(row => ({ ...row, searches: Number(row.searches), devices: Number(row.devices), emptyResults: Number(row.emptyResults) })),
    content: content.map(row => ({ ...row, playingDevices: Number(row.playingDevices), watchMs: Number(row.watchMs), failures: Number(row.failures) })),
    devices, browsers,
    regions: regions.map(row => ({ ...row, provinceName: PROVINCES.find(p => p[0] === row.province)?.[1] || '未知', countryName: row.country === 'CN' ? '中国' : row.country || '未知', city: row.city || '未知' })),
    newsletter: Object.fromEntries(Object.entries(newsletter).map(([key, value]) => [key, Number(value)])),
  };
}
export function promotionsCsv(report: Awaited<ReturnType<typeof promotionReport>>) {
  const cols: [string, string][] = [['name','链接名称'],['channel','渠道'],['activity','活动'],['placement','投放位置'],['creative','素材版本'],['url','推广链接'],['archived','已归档'],['arrivals','到站次数'],['visitors','访问设备'],['views','页面浏览'],['newVisitors','新访问设备'],['searchDevices','搜索设备'],['playingDevices','成功起播设备'],['playRate','起播转化率(%)'],['effectiveDevices','有效观看设备'],['effectiveRate','有效观看率(%)'],['watchMs','前台播放时长(ms)'],['newsletterDevices','订阅受理设备'],['notes','备注']];
  const cell = (value: unknown) => { let s = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const lines: unknown[][] = [[`北京时间 ${report.from} 至 ${report.to}；按推广到站日期归因；设备数不等于人数`], ...report.notices.map(n => [n]), cols.map(c => c[1]), ...report.links.map(r => cols.map(([key]) => (r as unknown as Record<string, unknown>)[key]))];
  function section(title: string, columns: [string,string][], data: Record<string, unknown>[]) { lines.push([], [title], columns.map(c => c[1]), ...data.map(r => columns.map(([key]) => r[key]))); }
  section('每日趋势', [['date','日期'],...cols.filter(([key]) => ['arrivals','visitors','views','newVisitors','searchDevices','playingDevices','playRate','effectiveDevices','effectiveRate','watchMs','newsletterDevices'].includes(key))], report.trend);
  if (report.detail) {
    const d = report.detail;
    section('搜索关键词（前50项）', [['query','关键词'],['searches','搜索次数'],['devices','设备'],['emptyResults','无结果']], d.searches);
    section('观看内容（前50项）', [['title','内容'],['media','类型'],['sourceKey','片源编号'],['sourceName','片源'],['vodId','内容编号'],['playingDevices','成功起播设备'],['watchMs','前台播放时长(ms)'],['failures','失败尝试']], d.content);
    section('设备', [['device','设备'],['visitors','设备数']], d.devices);
    section('浏览器', [['browser','浏览器'],['visitors','设备数']], d.browsers);
    section('地区（前100项）', [['country','国家'],['province','省份代码'],['city','城市'],['visitors','设备数']], d.regions);
    section('订阅入口表现', [['impressionDevices','展示设备'],['submitDevices','提交设备'],['acceptedDevices','受理设备'],['errorDevices','失败设备']], [d.newsletter]);
  }
  return '\uFEFF' + lines.map(r => r.map(cell).join(',')).join('\r\n');
}
