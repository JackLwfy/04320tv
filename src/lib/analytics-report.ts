import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';
import { analyticsEnabled } from './analytics-auth';
import { businessDay, DAY_MS, sqlDate } from './analytics-validation';
import type { AnalyticsCard, AnalyticsColumn, AnalyticsReport, AnalyticsTable, AnalyticsTrend, AnalyticsView, MetricFormat } from './analytics-types';

export interface ReportFilter { view: AnalyticsView; from: string; to: string; media: string; source: string; device: string; browser: string; page: number; test: boolean }
const views: AnalyticsView[] = ['overview', 'traffic', 'search', 'content', 'quality', 'newsletter', 'health'];
export function parseReportFilter(url: URL, now = Date.now()): ReportFilter {
  const p = url.searchParams;
  const view = (p.get('view') || 'overview') as AnalyticsView;
  if (!views.includes(view)) throw new Error('统计视图无效。');
  const today = businessDay(now);
  const from = p.get('from') || businessDay(now - 6 * DAY_MS); const to = p.get('to') || today;
  if (![from, to].every(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s) || from > to || to > today) throw new Error('请选择有效的日期范围。');
  if (from < businessDay(now - 399 * DAY_MS)) throw new Error('统计最长保留约 13 个月。');
  const media = p.get('media') || 'all'; const device = p.get('device') || 'all'; const browser = p.get('browser') || 'all'; const source = p.get('source') || '';
  if (!['all', 'vod', 'live'].includes(media) || !['all', 'mobile', 'desktop', 'tablet'].includes(device) || !['all', 'Chrome', 'Safari', 'Edge', 'Firefox', 'Other'].includes(browser) || (source && !/^[a-f0-9]{64}$/.test(source))) throw new Error('统计筛选无效。');
  if (from < businessDay(now - 89 * DAY_MS) && (view !== 'overview' || media !== 'all' || source || device !== 'all' || browser !== 'all')) throw new Error('细分明细保留 90 天；更早数据请在概览查看无筛选的日汇总。');
  const page = Number(p.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('页码无效。');
  return { view, from, to, media, source, device, browser, page, test: p.get('test') === '1' || process.env.ANALYTICS_TEST_MODE === 'true' };
}
export function percent(n: number, d: number) { return d > 0 ? Math.round(n / d * 10000) / 100 : null; }
export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const n = (value: unknown) => Number(value || 0);
const col = (key: string, label: string, format?: MetricFormat): AnalyticsColumn => ({ key, label, format });
const card = (key: string, label: string, value: number | null, format: MetricFormat, help: string, previous?: number | null): AnalyticsCard => ({ key, label, value, format, help, ...(previous !== undefined ? { previous } : {}) });
function bounds(f: ReportFilter) { return [sqlDate(Date.parse(`${f.from}T00:00:00+08:00`)), sqlDate(Date.parse(`${f.to}T00:00:00+08:00`) + DAY_MS)]; }
function where(f: ReportFilter, time = 'occurred_at', options: { media?: boolean; source?: boolean; alias?: string } = {}) {
  const a = options.alias ? `${options.alias}.` : '';
  const clauses = [`${a}is_test=?`, `${a}${time}>=?`, `${a}${time}<?`];
  const values: (string | number)[] = [f.test ? 1 : 0, ...bounds(f)];
  if (options.media !== false && f.media !== 'all') { clauses.push(`${a}media=?`); values.push(f.media); }
  if (options.source !== false && f.source) {
    if (time === 'occurred_at' && options.media !== false) {
      const outer = options.alias || 'analytics_events';
      clauses.push(`(${a}source_key=? OR (${a}kind='search' AND EXISTS (SELECT 1 FROM analytics_search_sources ss WHERE ss.search_id=${outer}.search_id AND ss.source_key=?)))`);
      values.push(f.source, f.source);
    } else { clauses.push(`${a}source_key=?`); values.push(f.source); }
  }
  if (f.device !== 'all') { clauses.push(`${a}device=?`); values.push(f.device); }
  if (f.browser !== 'all') { clauses.push(`${a}browser=?`); values.push(f.browser); }
  return { sql: clauses.join(' AND '), values };
}
async function rows(c: PoolConnection, sql: string, values: unknown[] = []) {
  const [result] = await c.query<RowDataPacket[]>({ sql: `SET STATEMENT max_statement_time=4 FOR ${sql}`, timeout: 5500 }, values);
  return result;
}
async function table(c: PoolConnection, f: ReportFilter, key: string, title: string, sql: string, values: unknown[], columns: AnalyticsColumn[], help?: string): Promise<AnalyticsTable> {
  const pageSize = 20;
  const data = await rows(c, `SELECT result.*, COUNT(*) OVER() AS _total FROM (${sql}) result LIMIT ? OFFSET ?`, [...values, pageSize, (f.page - 1) * pageSize]);
  let total = n(data[0]?._total);
  if (!data.length && f.page > 1) total = n((await rows(c, `SELECT COUNT(*) AS total FROM (${sql}) result`, values))[0]?.total);
  return { key, title, columns, help, rows: data.map(row => Object.fromEntries(columns.map(column => [column.key, row[column.key] === null || row[column.key] === undefined ? null : column.format && column.format !== 'text' ? n(row[column.key]) : String(row[column.key])]))), total, page: f.page, pageSize };
}
async function totals(c: PoolConnection, f: ReportFilter): Promise<Record<string, number | null>> {
  const e = where(f); const p = where(f, 'started_at');
  const event = (await rows(c, `SELECT COUNT(DISTINCT visitor_id) AS visitors,COUNT(DISTINCT session_id) AS sessions,
    COALESCE(SUM(kind='page_view'),0) AS views,COALESCE(SUM(kind='search'),0) AS searches,
    COALESCE(SUM(kind='search' AND status='empty'),0) AS empty_searches,
    COALESCE(SUM(kind='search' AND status='error'),0) AS failed_searches,
    COALESCE(SUM(kind='search' AND status='partial'),0) AS partial_searches,
    COUNT(DISTINCT CASE WHEN kind='search' AND EXISTS (SELECT 1 FROM analytics_events clicked WHERE clicked.kind='search_click' AND clicked.search_id=analytics_events.search_id AND clicked.visitor_id=analytics_events.visitor_id AND clicked.is_test=analytics_events.is_test) THEN search_id END) AS clicked_searches,
    COUNT(DISTINCT CASE WHEN kind='search' AND EXISTS (SELECT 1 FROM analytics_playback played WHERE played.search_id=analytics_events.search_id AND played.visitor_id=analytics_events.visitor_id AND played.is_test=analytics_events.is_test AND played.first_frame_ms IS NOT NULL) THEN search_id END) AS played_searches,
    COALESCE(SUM(kind='recommendation_impression'),0) AS impressions,COALESCE(SUM(kind='recommendation_click'),0) AS recommendation_clicks
    FROM analytics_events WHERE ${e.sql}`, e.values))[0];
  const playback = (await rows(c, `SELECT COUNT(*) AS attempts,COUNT(DISTINCT visitor_id) AS watching_devices,
    COALESCE(SUM(first_frame_ms IS NOT NULL),0) AS starts,
    COALESCE(SUM(played_ms>=30000 OR (media_duration_ms>0 AND media_duration_ms<30000 AND status='ended')),0) AS effective,
    COALESCE(SUM(played_ms),0) AS watch_ms,COALESCE(SUM(hidden_played_ms),0) AS hidden_ms,COALESCE(SUM(buffer_ms),0) AS buffer_ms,
    COALESCE(SUM(buffer_count),0) AS buffer_count,COALESCE(SUM(status='error'),0) AS errors,
    COALESCE(SUM(first_frame_ms IS NULL AND status='timeout'),0) AS timeouts,
    COALESCE(SUM(first_frame_ms IS NULL AND status='abandoned'),0) AS cancelled,
    COALESCE(SUM(first_frame_ms IS NULL AND status NOT IN ('error','timeout','abandoned')),0) AS unconfirmed,
    COALESCE(SUM(previous_attempt_id IS NOT NULL),0) AS switches,
    COALESCE(SUM(previous_attempt_id IS NOT NULL AND first_frame_ms IS NOT NULL),0) AS recovered,
    COALESCE(SUM(first_frame_method='progress'),0) AS fallback_frames
    FROM analytics_playback WHERE ${p.sql}`, p.values))[0];
  const latency = (await rows(c, `SELECT MAX(CASE WHEN rn=CEIL(cnt*0.5) THEN first_frame_ms END) AS median,
    MAX(CASE WHEN rn=CEIL(cnt*0.95) THEN first_frame_ms END) AS p95 FROM
    (SELECT first_frame_ms,ROW_NUMBER() OVER (ORDER BY first_frame_ms) rn,COUNT(*) OVER() cnt FROM analytics_playback WHERE ${p.sql} AND first_frame_ms IS NOT NULL) measured`, p.values))[0];
  return { ...Object.fromEntries(Object.entries({ ...event, ...playback }).map(([key, value]) => [key, n(value)])), median: latency.median === null ? null : n(latency.median), p95: latency.p95 === null ? null : n(latency.p95) };
}
async function trend(c: PoolConnection, f: ReportFilter): Promise<AnalyticsTrend[]> {
  const e = where(f); const p = where(f, 'started_at');
  const events = await rows(c, `SELECT DATE(DATE_ADD(occurred_at,INTERVAL 8 HOUR)) AS day,SUM(kind='page_view') views,COUNT(DISTINCT visitor_id) visitors,SUM(kind='search') searches FROM analytics_events WHERE ${e.sql} GROUP BY day`, e.values);
  const plays = await rows(c, `SELECT DATE(DATE_ADD(started_at,INTERVAL 8 HOUR)) AS day,SUM(first_frame_ms IS NOT NULL) starts,SUM(played_ms) watch_ms,SUM(status IN ('error','timeout')) failures FROM analytics_playback WHERE ${p.sql} GROUP BY day`, p.values);
  const days: AnalyticsTrend[] = [];
  for (let date = Date.parse(f.from); date <= Date.parse(f.to); date += DAY_MS) {
    const day = new Date(date).toISOString().slice(0, 10); const ev = events.find(r => r.day === day); const pl = plays.find(r => r.day === day);
    days.push({ date: day, views: n(ev?.views), visitors: n(ev?.visitors), searches: n(ev?.searches), starts: n(pl?.starts), watchMs: n(pl?.watch_ms), failures: n(pl?.failures) });
  }
  return days;
}

export async function analyticsReport(f: ReportFilter): Promise<AnalyticsReport> {
  const c = await analyticsPool().getConnection();
  try {
    const e = where(f); const p = where(f, 'started_at'); const s = where(f, 'occurred_at', { media: false });
    const health = (await rows(c, 'SELECT (SELECT enabled FROM analytics_meta WHERE id=1) enabled,(SELECT created_at FROM analytics_meta WHERE id=1) created_at,MAX(last_received_at) last_event FROM analytics_ingest_daily'))[0];
    const report: AnalyticsReport = { view: f.view, from: f.from, to: f.to, generatedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', enabled: analyticsEnabled() && !!health.enabled, lastEventAt: health.last_event ? String(health.last_event).replace(' ', 'T') + 'Z' : null, cards: [], trend: [], tables: [], notices: ['访客按匿名浏览器标识去重，并非真实人数；浏览器事件可能漏报或被伪造。', '观看时长按播放尝试开始日期归属；跨午夜长播放会记入开始日。'], sources: [] };
    const collectionStart = health.created_at ? Date.parse(String(health.created_at).replace(' ', 'T') + 'Z') : Date.now();
    const firstDay = businessDay(collectionStart);
    if (health.created_at) report.notices.push(`统计从 ${new Date(collectionStart).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）开始采集，之前没有历史数据。`);
    if (f.test) report.notices.push('当前为隔离测试数据，不计入正式报表。');
    if (f.to < firstDay && f.view !== 'health') {
      report.cards = [card('history', '历史数据', null, 'number', '所选日期早于统计启用时间，没有历史记录，不代表访问量为零。')];
      return report;
    }
    const sourceRows = await rows(c, `SELECT source_key,MAX(source_name) source_name FROM
      (SELECT source_key,source_name FROM analytics_playback WHERE is_test=? AND started_at>=? UNION ALL SELECT source_key,source_name FROM analytics_search_sources WHERE is_test=? AND occurred_at>=?) sources
      WHERE source_key<>'' GROUP BY source_key ORDER BY source_name LIMIT 200`, [f.test ? 1 : 0, bounds(f)[0], f.test ? 1 : 0, bounds(f)[0]]);
    report.sources = sourceRows.map(row => ({ key: String(row.source_key), name: String(row.source_name || '未命名片源') }));
    if (f.from < businessDay(Date.now() - 89 * DAY_MS)) {
      const daily = await rows(c, 'SELECT * FROM analytics_daily WHERE is_test=? AND day>=? AND day<=? ORDER BY day', [f.test ? 1 : 0, f.from < firstDay ? firstDay : f.from, f.to]);
      const sum = (key: string) => daily.reduce((a, r) => a + n(r[key]), 0);
      report.cards = [card('views', '页面浏览', sum('views'), 'number', '日汇总相加。'), card('visitors', '区间去重设备', null, 'number', '超过明细保留期，不能将每日UV相加当作区间UV。'), card('searches', '搜索次数', sum('searches'), 'number', '日汇总相加。'), card('starts', '成功起播', sum('starts'), 'number', '日汇总相加。'), card('watch', '有效播放时长', sum('watch_ms'), 'duration', '不含暂停和缓冲。'), card('success', '起播成功率', percent(sum('starts'), sum('attempts')), 'percent', '含所有播放尝试的历史汇总。')];
      report.trend = daily.map(r => ({ date: String(r.day), views: n(r.views), visitors: n(r.visitors), searches: n(r.searches), starts: n(r.starts), watchMs: n(r.watch_ms), failures: n(r.failures) }));
      report.notices.push('历史概览来自定时汇总；细分查询、任意区间UV和精确延迟分位数仅支持最近90天。');
      return report;
    }
    if (f.view === 'health') {
      const metrics = (await rows(c, 'SELECT COALESCE(SUM(accepted),0) accepted,COALESCE(SUM(duplicates),0) duplicates,COALESCE(SUM(rejected),0) rejected FROM analytics_ingest_daily WHERE day>=? AND day<=?', [f.from, f.to]))[0];
      const dbSize = (await rows(c, 'SELECT SUM(data_length+index_length) bytes FROM information_schema.tables WHERE table_schema=DATABASE()'))[0];
      const [tls] = await c.query<RowDataPacket[]>({ sql: "SHOW SESSION STATUS LIKE 'Ssl_cipher'", timeout: 3000 });
      const jobs = await rows(c, 'SELECT name,status,finished_at FROM analytics_jobs');
      for (const [name, minutes] of [['rollup', 15], ['backup', 26 * 60], ['cleanup', 26 * 60]] as const) {
        const job = jobs.find(row => row.name === name);
        const finished = job?.finished_at ? Date.parse(String(job.finished_at).replace(' ', 'T') + 'Z') : 0;
        if (!job || job.status === 'failed' || (job.status !== 'running' && Date.now() - finished > minutes * 60000)) report.notices.push(`任务 ${name} 缺失、失败或已超过预期运行间隔，请检查服务器定时任务。`);
        else if (name === 'rollup' && finished) report.notices.push(`最近日汇总完成于 ${Math.max(0, Math.floor((Date.now() - finished) / 60000))} 分钟前。最近90天明细报表直接查询已入库数据。`);
      }
      report.cards = [card('enabled', '采集开关', report.enabled ? 1 : 0, 'number', '1为启用，0为关闭；关闭后网站仍可正常使用。'), card('accepted', '受理事件', n(metrics.accepted), 'number', '数据库已提交的正式事件，包含短期去重回执。'), card('duplicates', '重复已去除', n(metrics.duplicates), 'number', '传输重试不会重复累加。'), card('rejected', '无效事件批次', n(metrics.rejected), 'number', '已收到但未通过校验的批次；网络完全未到达的请求无法统计。'), card('size', '统计库大小', n(dbSize.bytes), 'bytes', '数据库估计的数据和索引占用。'), card('tls', '加密连接', tls[0]?.Value ? 1 : 0, 'number', '当前报表数据库连接启用了TLS。')];
      report.tables.push(await table(c, f, 'jobs', '汇总、清理与备份', 'SELECT name,status,started_at,finished_at,duration_ms,detail FROM analytics_jobs ORDER BY started_at DESC', [], [col('name', '任务'), col('status', '状态'), col('started_at', '开始时间（UTC）'), col('finished_at', '完成时间（UTC）'), col('duration_ms', '耗时', 'milliseconds'), col('detail', '结果')]));
      report.tables.push(await table(c, f, 'ingest', '每日采集记录', 'SELECT day,accepted,duplicates,rejected,last_received_at FROM analytics_ingest_daily WHERE day>=? AND day<=? ORDER BY day DESC', [f.from, f.to], [col('day', '日期'), col('accepted', '受理', 'number'), col('duplicates', '重复', 'number'), col('rejected', '无效批次', 'number'), col('last_received_at', '最近入库（UTC）')]));
      report.notices.push('仅使用独立统计库；数据库故障时无法写入失败计数，服务不可用不代表零访问。结构化事实保留90天、回执2天、日汇总400天。');
      return report;
    }
    const total = await totals(c, f);
    report.trend = await trend(c, { ...f, from: f.from < firstDay ? firstDay : f.from });
    const count = (key: string) => n(total[key]);
    const frameHelp = '首帧回调优先；不支持时使用播放进度前进兜底。仅统计成功起播的样本。';
    if (f.view === 'overview') {
      const length = Date.parse(f.to) - Date.parse(f.from) + DAY_MS;
      const previous = { ...f, from: new Date(Date.parse(f.from) - length).toISOString().slice(0, 10), to: new Date(Date.parse(f.from) - DAY_MS).toISOString().slice(0, 10) };
      const old = previous.from >= businessDay(Date.now() - 89 * DAY_MS) && previous.from >= firstDay ? await totals(c, previous) : null;
      report.cards = [card('visitors', '访问设备', count('visitors'), 'number', '所选范围内匿名浏览器去重；不可与每日UV相加混用。', old ? n(old.visitors) : null), card('searches', '搜索次数', count('searches'), 'number', '逻辑搜索请求；重试不重复计数。', old ? n(old.searches) : null), card('starts', '成功起播', count('starts'), 'number', '确认首帧的播放尝试。', old ? n(old.starts) : null), card('watch', '有效播放时长', count('watch_ms'), 'duration', '实际播放累计，排除暂停、缓冲与跳转；包含后台播放。', old ? n(old.watch_ms) : null), card('success', '起播成功率', percent(count('starts'), count('attempts') - count('cancelled')), 'percent', '成功起播／剔除首帧前主动退出后的尝试；未确认仍计入分母。', old ? percent(n(old.starts), n(old.attempts) - n(old.cancelled)) : null), card('sessions', '访问次数', count('sessions'), 'number', '连续30分钟无活动后开始新会话。', old ? n(old.sessions) : null)];
      report.tables.push(await table(c, f, 'searches', '大家在搜', `SELECT query_text,COUNT(*) searches,SUM(status='empty') empty_results,SUM(status='error') failures FROM analytics_events WHERE ${e.sql} AND kind='search' GROUP BY query_text ORDER BY searches DESC,query_text`, e.values, [col('query_text', '关键词'), col('searches', '搜索', 'number'), col('empty_results', '无结果', 'number'), col('failures', '失败', 'number')]));
    } else if (f.view === 'traffic') {
      const [start, end] = bounds(f);
      const fresh = (await rows(c, `SELECT COUNT(DISTINCT e.visitor_id) total FROM analytics_events e JOIN analytics_visitors v ON v.visitor_id=e.visitor_id WHERE ${where(f, 'occurred_at', { alias: 'e' }).sql} AND v.first_seen>=? AND v.first_seen<?`, [...where(f, 'occurred_at', { alias: 'e' }).values, start, end]))[0];
      const active = (await rows(c, 'SELECT COUNT(DISTINCT visitor_id) total FROM analytics_visitors WHERE is_test=? AND last_seen>=?', [f.test ? 1 : 0, sqlDate(Date.now() - 300000)]))[0];
      report.cards = [card('views', '页面浏览 PV', count('views'), 'number', '页面打开和有效路由切换，不包含接口请求。'), card('visitors', '访问设备 UV', count('visitors'), 'number', '区间内匿名浏览器去重。'), card('sessions', '访问次数', count('sessions'), 'number', '连续30分钟无活动后开始新会话。'), card('new', '首次访问设备', n(fresh.total), 'number', '在已保留的设备标识记录中首次出现。'), card('return', '回访设备', Math.max(0, count('visitors') - n(fresh.total)), 'number', '所选范围之前已经出现的设备；清理浏览器数据会影响判断。'), card('active', '最近5分钟活跃', n(active.total), 'number', '全站当前估算值，不受日期与设备筛选影响，并非精确在线人数。')];
      report.tables.push(await table(c, f, 'channels', '入口与来源', `SELECT page,COALESCE(NULLIF(referrer,''),'直接访问') referrer,COALESCE(NULLIF(campaign,''),'—') campaign,COUNT(*) views,COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE ${e.sql} AND kind='page_view' GROUP BY page,referrer,campaign ORDER BY views DESC,page`, e.values, [col('page', '页面'), col('referrer', '来源域名'), col('campaign', '渠道'), col('views', 'PV', 'number'), col('visitors', '设备', 'number')]));
      report.tables.push(await table(c, f, 'devices', '设备与浏览器', `SELECT device,browser,COUNT(*) events,COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE ${e.sql} GROUP BY device,browser ORDER BY visitors DESC`, e.values, [col('device', '设备'), col('browser', '浏览器'), col('visitors', '访问设备', 'number'), col('events', '行为事件', 'number')]));
      report.tables.push(await table(c, f, 'hours', '北京时间小时分布', `SELECT HOUR(DATE_ADD(occurred_at,INTERVAL 8 HOUR)) hour,SUM(kind='page_view') views,SUM(kind='search') searches,COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE ${e.sql} GROUP BY hour ORDER BY hour`, e.values, [col('hour', '小时', 'number'), col('views', 'PV', 'number'), col('searches', '搜索', 'number'), col('visitors', '设备', 'number')]));
    } else if (f.view === 'search') {
      report.cards = [card('searches', '搜索次数', count('searches'), 'number', '逻辑请求计数。'), card('empty', '无结果率', percent(count('empty_searches'), count('searches') - count('failed_searches')), 'percent', '正常完成却没有匹配内容，不包含全部失败。'), card('failures', '全部失败', count('failed_searches'), 'number', '全部片源失败；不当作没有影片。'), card('partial', '部分失败', count('partial_searches'), 'number', '至少一个片源失败但仍有可用返回。'), card('click', '搜索点击率', percent(count('clicked_searches'), count('searches')), 'percent', '所选范围的搜索中，关联同一设备且已有结果点击的搜索占比。'), card('play', '搜索到起播', percent(count('played_searches'), count('searches')), 'percent', '所选范围的搜索中，关联同一设备且已成功起播的搜索占比。')];
      report.tables.push(await table(c, f, 'terms', '搜索词与缺失内容', `SELECT query_text,COUNT(*) searches,COUNT(DISTINCT visitor_id) visitors,SUM(status='empty') empty_results,SUM(status='error') failures,SUM(status='partial') partial_results,ROUND(AVG(duration_ms)) average_ms FROM analytics_events WHERE ${e.sql} AND kind='search' GROUP BY query_text ORDER BY searches DESC,query_text`, e.values, [col('query_text', '关键词'), col('searches', '搜索', 'number'), col('visitors', '设备', 'number'), col('empty_results', '无结果', 'number'), col('failures', '失败', 'number'), col('partial_results', '部分成功', 'number'), col('average_ms', '平均耗时', 'milliseconds')]));
      report.tables.push(await table(c, f, 'missing', '无结果搜索', `SELECT query_text,COUNT(*) total FROM analytics_events WHERE ${e.sql} AND kind='search' AND status='empty' GROUP BY query_text ORDER BY total DESC,query_text`, e.values, [col('query_text', '关键词'), col('total', '次数', 'number')]));
      report.tables.push(await table(c, f, 'search_sources', '片源搜索表现', `SELECT source_name,source_origin,COUNT(*) samples,ROUND(100*SUM(status IN ('success','empty'))/COUNT(*),2) success_rate,SUM(status='empty') empty_results,SUM(status='timeout') timeouts,ROUND(AVG(duration_ms)) average_ms FROM analytics_search_sources WHERE ${s.sql} GROUP BY source_key,source_name,source_origin ORDER BY samples DESC,source_name`, s.values, [col('source_name', '片源'), col('source_origin', '来源类型'), col('samples', '样本', 'number'), col('success_rate', '接口成功率', 'percent'), col('empty_results', '空结果', 'number'), col('timeouts', '超时', 'number'), col('average_ms', '平均耗时', 'milliseconds')], '搜索结果来自浏览器观测；空结果不等于接口故障。'));
    } else if (f.view === 'content') {
      report.cards = [card('attempts', '播放尝试', count('attempts'), 'number', '换源是新尝试，传输重试不是。'), card('starts', '成功起播', count('starts'), 'number', frameHelp), card('effective', '有效观看', count('effective'), 'number', '播放至少30秒，或短于30秒内容完整结束。'), card('devices', '观看设备', count('watching_devices'), 'number', '发起播放尝试的匿名设备去重。'), card('average', '平均观看时长', count('starts') ? count('watch_ms') / count('starts') : null, 'duration', '累计播放时长／成功起播次数。'), card('hidden', '后台播放时长', count('hidden_ms'), 'duration', '属于播放时长的子集；页面隐藏时继续播放。')];
      report.tables.push(await table(c, f, 'titles', '影片与分集热度', `SELECT source_name,title,vod_id,episode,COUNT(*) attempts,SUM(first_frame_ms IS NOT NULL) starts,COUNT(DISTINCT visitor_id) devices,SUM(played_ms) watch_ms,SUM(status='error') errors FROM analytics_playback WHERE ${p.sql} GROUP BY source_key,source_name,vod_id,title,episode ORDER BY starts DESC,watch_ms DESC,title`, p.values, [col('title', '影片／频道'), col('source_name', '片源'), col('episode', '集索引（从0起）', 'number'), col('attempts', '尝试', 'number'), col('starts', '起播', 'number'), col('devices', '设备', 'number'), col('watch_ms', '时长', 'duration'), col('errors', '错误', 'number')], '不同片源影片尚未建立统一映射，不按片名自动合并。'));
      report.tables.push(await table(c, f, 'content_clicks', '内容点击与详情访问', `SELECT title,source_name,vod_id,SUM(kind='search_click') clicks,SUM(kind='detail_view') details,COUNT(DISTINCT visitor_id) devices FROM analytics_events WHERE ${e.sql} AND kind IN ('search_click','detail_view') GROUP BY source_key,source_name,vod_id,title ORDER BY clicks DESC,details DESC,title`, e.values, [col('title', '影片'), col('source_name', '片源'), col('clicks', '搜索点击', 'number'), col('details', '详情查看', 'number'), col('devices', '设备', 'number')]));
      report.tables.push(await table(c, f, 'continuation', '多集观看', `SELECT title,source_name,COUNT(*) sessions,ROUND(AVG(episodes),1) average_episodes FROM (SELECT session_id,title,source_name,source_key,vod_id,COUNT(DISTINCT episode) episodes FROM analytics_playback WHERE ${p.sql} AND media='vod' AND first_frame_ms IS NOT NULL GROUP BY session_id,title,source_name,source_key,vod_id HAVING episodes>1) continued GROUP BY title,source_key,source_name,vod_id ORDER BY sessions DESC,title`, p.values, [col('title', '影片'), col('source_name', '片源'), col('sessions', '多集会话', 'number'), col('average_episodes', '平均集数', 'number')], '同一次访问中成功播放多个不同集数，不等同于严格连续看完。'));
      report.tables.push(await table(c, f, 'recommendations', '推荐内容效果', `SELECT recommendation_id,SUM(kind='recommendation_impression') impressions,SUM(kind='recommendation_click') clicks,ROUND(100*SUM(kind='recommendation_click')/NULLIF(SUM(kind='recommendation_impression'),0),2) click_rate FROM analytics_events WHERE ${e.sql} AND kind IN ('recommendation_impression','recommendation_click') GROUP BY recommendation_id ORDER BY impressions DESC,recommendation_id`, e.values, [col('recommendation_id', '推荐内容'), col('impressions', '可见曝光', 'number'), col('clicks', '点击', 'number'), col('click_rate', '点击率', 'percent')]));
      report.tables.push(await table(c, f, 'recommendation_plays', '推荐后的起播', `SELECT recommendation_id,COUNT(*) attempts,SUM(first_frame_ms IS NOT NULL) starts,SUM(played_ms) watch_ms FROM analytics_playback WHERE ${p.sql} AND recommendation_id<>'' GROUP BY recommendation_id ORDER BY starts DESC,recommendation_id`, p.values, [col('recommendation_id', '推荐内容'), col('attempts', '播放尝试', 'number'), col('starts', '成功起播', 'number'), col('watch_ms', '观看时长', 'duration')], '推荐点击后30分钟内经关联搜索进入播放；不代表推荐曝光的因果效果。'));
    } else if (f.view === 'quality') {
      report.cards = [card('success', '起播成功率', percent(count('starts'), count('attempts') - count('cancelled')), 'percent', '剔除首帧前主动退出，未确认仍保留在分母。'), card('median', '起播中位数', total.median, 'milliseconds', frameHelp), card('p95', '起播 P95', total.p95, 'milliseconds', frameHelp), card('buffer', '卡顿率', percent(count('buffer_ms'), count('watch_ms') + count('buffer_ms')), 'percent', '起播后非拖动缓冲／实际播放及缓冲时间。'), card('errors', '致命错误', count('errors'), 'number', '最新状态为error的播放尝试，不包括可恢复的内部重试。'), card('recovery', '换源恢复率', percent(count('recovered'), count('switches')), 'percent', '有前一尝试关联且新线路成功起播。')];
      report.notices.push(`首帧前主动退出 ${count('cancelled')} 次，超时 ${count('timeouts')} 次，未确认 ${count('unconfirmed')} 次；${count('fallback_frames')} 次采用进度前进测量。探测可达不等同真实起播。`);
      report.tables.push(await table(c, f, 'sources', '播放片源质量', `SELECT source_name,source_origin,media,COUNT(*) samples,SUM(first_frame_ms IS NOT NULL) starts,ROUND(100*SUM(first_frame_ms IS NOT NULL)/NULLIF(COUNT(*)-SUM(first_frame_ms IS NULL AND status='abandoned'),0),2) success_rate,ROUND(AVG(first_frame_ms)) average_ms,SUM(buffer_count) stalls,ROUND(100*SUM(buffer_ms)/NULLIF(SUM(buffer_ms+played_ms),0),2) buffer_rate,SUM(status IN ('error','timeout')) failures,IF(COUNT(*)<20,'样本不足','可比较') sample_note FROM analytics_playback WHERE ${p.sql} GROUP BY source_key,source_name,source_origin,media ORDER BY samples DESC,source_name`, p.values, [col('source_name', '片源'), col('source_origin', '来源类型'), col('media', '类型'), col('samples', '样本', 'number'), col('success_rate', '起播率', 'percent'), col('average_ms', '平均起播', 'milliseconds'), col('buffer_rate', '卡顿率', 'percent'), col('failures', '失败', 'number'), col('sample_note', '样本状态')]));
      report.tables.push(await table(c, f, 'errors', '故障定位', `SELECT COALESCE(NULLIF(error_code,''),status) error_code,source_name,title,episode,device,browser,COUNT(*) total FROM analytics_playback WHERE ${p.sql} AND status IN ('error','timeout') GROUP BY error_code,status,source_key,source_name,title,episode,device,browser ORDER BY total DESC,title`, p.values, [col('error_code', '错误'), col('source_name', '片源'), col('title', '影片／频道'), col('episode', '集索引', 'number'), col('device', '设备'), col('browser', '浏览器'), col('total', '次数', 'number')]));
    } else if (f.view === 'newsletter') {
      const funnel = (await rows(c, `SELECT SUM(kind='newsletter_impression') impressions,SUM(kind='newsletter_close') closes,SUM(kind='newsletter_submit') submits,SUM(kind='newsletter_accepted') accepted,SUM(kind='newsletter_error') errors FROM analytics_events WHERE ${e.sql}`, e.values))[0];
      report.cards = [card('impressions', '弹窗展示', n(funnel.impressions), 'number', '真实前台弹窗，后台预览不计入。'), card('close', '关闭', n(funnel.closes), 'number', '用户关闭弹窗。'), card('submits', '提交', n(funnel.submits), 'number', '提交尝试，不保存邮箱地址。'), card('accepted', '接口受理', n(funnel.accepted), 'number', '外部接口返回accepted；不代表确认订阅或邮件送达。'), card('errors', '提交失败', n(funnel.errors), 'number', '接口失败或暂不可用。'), card('conversion', '展示到受理', percent(n(funnel.accepted), n(funnel.impressions)), 'percent', '事件量比值，非按邮箱去重的订阅转化。')];
      report.tables.push(await table(c, f, 'newsletter', '每日订阅入口表现', `SELECT DATE(DATE_ADD(occurred_at,INTERVAL 8 HOUR)) day,SUM(kind='newsletter_impression') impressions,SUM(kind='newsletter_submit') submits,SUM(kind='newsletter_accepted') accepted,SUM(kind='newsletter_error') errors FROM analytics_events WHERE ${e.sql} AND kind LIKE 'newsletter_%' GROUP BY day ORDER BY day DESC`, e.values, [col('day', '日期'), col('impressions', '展示', 'number'), col('submits', '提交', 'number'), col('accepted', '受理', 'number'), col('errors', '失败', 'number')]));
      report.notices.push('确认订阅、邮件发送、退信与退订数据尚无外部状态回传，不显示为零或已完成。');
    }
    return report;
  } finally { c.release(); }
}

export function reportCsv(report: AnalyticsReport): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines: string[] = [[report.view, report.from, report.to, 'Asia/Shanghai', '当前页'].map(cell).join(',')];
  for (const table of report.tables) {
    lines.push('', cell(table.title), table.columns.map(column => cell(column.label + (column.format === 'duration' || column.format === 'milliseconds' ? '（毫秒）' : column.format === 'percent' ? '（%）' : column.format === 'bytes' ? '（字节）' : ''))).join(','));
    for (const row of table.rows) lines.push(table.columns.map(column => cell(row[column.key])).join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}
