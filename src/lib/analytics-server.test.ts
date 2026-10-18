import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsEnabled, analyticsOrigin, createDeviceCookie, DEVICE_COOKIE, newIdentity, rateBucket, readDevice, signAnalyticsToken, verifyAnalyticsToken, visitorHash } from './analytics-auth';
import { businessDay, clientDimensions, DAY_MS, privateText, sourceHash, sqlDate, validateEvents } from './analytics-validation';
import { parseReportFilter, percent, percentile, reportCsv } from './analytics-report';
import { ingestEvents } from './analytics-ingest';
import { analyticsPool } from './analytics-db';
import { privateAnalyticsEvent } from './analytics-client';
import type { AnalyticsEventInput, AnalyticsReport } from './analytics-types';

vi.mock('./analytics-db', () => ({ analyticsPool: vi.fn() }));

const now = Date.parse('2026-10-14T10:00:00Z');
const visitor = '12345678-1234-4234-8234-123456789abc';
const eventId = '12345678-1234-4234-8234-123456789abd';
const searchId = '12345678-1234-4234-8234-123456789abe';
const base = (): AnalyticsEventInput => ({ type: 'page_view', id: eventId, at: now, page: '/' });
const playback = (): AnalyticsEventInput => ({ ...base(), type: 'playback', media: 'vod', sourceKey: 'site-a', watchId: visitor, attemptId: eventId, startedAt: now - 60_000, sequence: 3, playbackStatus: 'playing', playedMs: 40_000, hiddenPlayedMs: 5000, bufferMs: 1000, seekBufferMs: 2000, firstFrameMs: 800, firstFrameMethod: 'frame' });

beforeEach(() => {
  vi.stubEnv('ANALYTICS_INGEST_SECRET', 'test-only-statistics-secret-at-least-32-chars');
  vi.stubEnv('ADMIN_ORIGIN', 'https://example.test');
  vi.stubEnv('ANALYTICS_TEST_MODE', 'false');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe('analytics identity trust boundary', () => {
  it('accepts signed identity, preserves a valid session, and rejects expired or changed tokens', () => {
    const identity = newIdentity(visitor, searchId, true, now);
    expect(identity.session).toBe(searchId);
    const token = signAnalyticsToken(identity);
    expect(verifyAnalyticsToken(token, now)).toEqual(identity);
    expect(verifyAnalyticsToken(token, identity.expires)).toBeNull();
    const [body, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...identity, test: false })).toString('base64url');
    expect(verifyAnalyticsToken(`${changed}.${signature}`, now)).toBeNull();
    expect(verifyAnalyticsToken(`${body}.${signature}.extra`, now)).toBeNull();
    expect(verifyAnalyticsToken('x'.repeat(1001), now)).toBeNull();
  });
  it('rejects correctly signed invalid identity fields and excessive expiry', () => {
    const identity = newIdentity(visitor, undefined, false, now);
    for (const change of [{ visitor: 'invalid' }, { session: 'invalid' }, { test: 'true' }, { expires: now + DAY_MS + 1 }]) {
      expect(verifyAnalyticsToken(signAnalyticsToken({ ...identity, ...change } as typeof identity), now)).toBeNull();
    }
  });
  it('checks device cookie signature and exact shape, independently from bearer tokens', () => {
    const cookie = createDeviceCookie(visitor);
    const req = (value: string) => new Request('https://example.test', { headers: { cookie: `other=1; ${DEVICE_COOKIE}=${value}` } });
    expect(readDevice(req(cookie))).toBe(visitor);
    expect(readDevice(req(cookie.replace(visitor, searchId)))).toBeNull();
    expect(readDevice(req(`${cookie}.extra`))).toBeNull();
    expect(verifyAnalyticsToken(cookie, now)).toBeNull();
    expect(readDevice(new Request('https://example.test'))).toBeNull();
    expect(visitorHash(visitor)).not.toBe(rateBucket(visitor));
    expect(visitorHash(visitor, true)).not.toBe(visitorHash(visitor));
  });
  it('requires configured exact same origin and JSON, and an explicit enable flag', () => {
    const req = (origin: string, contentType = 'application/json') => new Request('https://example.test/api/analytics/collect', { headers: { origin, 'content-type': contentType } });
    expect(analyticsOrigin(req('https://example.test', 'application/json; charset=UTF-8'))).toBe(true);
    expect(analyticsOrigin(req('https://example.test.evil.test'))).toBe(false);
    expect(analyticsOrigin(req('https://example.test', 'text/plain'))).toBe(false);
    vi.stubEnv('ANALYTICS_ENABLED', 'false'); expect(analyticsEnabled()).toBe(false);
    vi.stubEnv('ANALYTICS_ENABLED', 'true'); expect(analyticsEnabled()).toBe(true);
    vi.stubEnv('ANALYTICS_INGEST_SECRET', ''); expect(analyticsEnabled()).toBe(false);
  });
});

describe('analytics input and browser compatibility', () => {
  it.each([null, {}, [], Array.from({ length: 21 }, base), [null], [{ ...base(), type: 'admin_login' }], [{ ...base(), id: 'invalid' }], [{ ...base(), at: now - DAY_MS - 1 }], [{ ...base(), at: now + 60001 }]])('rejects malformed or out-of-window input %#', (input) => {
    expect(() => validateEvents(input, now)).toThrow();
  });
  it('clamps small future clock skew, strips secrets, and uses equivalent private source identifiers', async () => {
    const raw = { ...base(), at: now + 500, sourceKey: 'sub_https://source.test/list?token=secret', title: '影片 https://source.test?token=secret a@example.test', referrer: 'search.example.test' };
    const client = await privateAnalyticsEvent(raw);
    const [accepted] = validateEvents([client], now);
    expect(accepted.at).toBe(now);
    expect(accepted.sourceKey).toBe(sourceHash(raw.sourceKey));
    expect(accepted.referrer).toBe('search.example.test');
    expect(JSON.stringify(client)).not.toContain('secret');
    expect(JSON.stringify(accepted)).not.toContain('a@example.test');
    expect(privateText('test\nuser@example.test https://a.test/?password=x', 200)).toBe('test [邮箱] [链接]');
  });
  it('requires search identity, status and unique per-source results', () => {
    const outcome = { sourceKey: 'site-a', sourceName: 'A', status: 'empty', durationMs: 5, resultCount: 0 };
    const search = { ...base(), type: 'search', searchId, searchStatus: 'empty', outcomes: [outcome] };
    expect(validateEvents([search], now)[0].outcomes?.[0].status).toBe('empty');
    expect(() => validateEvents([{ ...search, searchId: undefined }], now)).toThrow();
    expect(() => validateEvents([{ ...search, outcomes: [outcome, { ...outcome, sourceKey: `sha256:${sourceHash('site-a')}` }] }], now)).toThrow();
    expect(() => validateEvents([{ ...search, outcomes: [{ ...outcome, durationMs: NaN }] }], now)).toThrow();
    expect(() => validateEvents([{ ...search, outcomes: Array(51).fill(outcome) }], now)).toThrow();
  });
  it.each([
    { playedMs: -1 }, { playedMs: Infinity }, { hiddenPlayedMs: 40001 },
    { playedMs: 60000, bufferMs: 60000 }, { startedAt: now + 1 },
    { firstFrameMethod: undefined }, { sourceKey: '' }, { attemptId: 'invalid' },
    { sequence: 1000001 }, { mediaDurationMs: Infinity }, { playbackStatus: 'paused' },
  ])('rejects impossible or incomplete playback snapshot %#', (change) => {
    expect(() => validateEvents([{ ...playback(), ...change }], now)).toThrow();
  });
  it('accepts finite cumulative snapshots, unknown duration and progress-based first frame', async () => {
    const client = await privateAnalyticsEvent({ ...playback(), mediaDurationMs: undefined, firstFrameMethod: 'progress' });
    const [accepted] = validateEvents([client], now);
    expect(accepted.playedMs).toBe(40000); expect(accepted.mediaDurationMs).toBe(0);
    expect(accepted.firstFrameMethod).toBe('progress');
    expect(clientDimensions('Mozilla Android Mobile Chrome/130 Safari/537')).toEqual({ device: 'mobile', browser: 'Chrome' });
    expect(clientDimensions('Mozilla iPad Safari/604')).toEqual({ device: 'tablet', browser: 'Safari' });
  });
});

describe('analytics reporting boundaries', () => {
  const url = (query = '') => new URL(`https://example.test/api/admin/analytics?${query}`);
  it('uses Beijing dates, UTC SQL timestamps and inclusive requested date ranges', () => {
    const midnight = Date.parse('2026-10-13T16:00:00.123Z');
    expect(businessDay(midnight)).toBe('2026-10-14');
    expect(sqlDate(midnight)).toBe('2026-10-13 16:00:00.123');
    expect(parseReportFilter(url(), now)).toMatchObject({ from: '2026-10-08', to: '2026-10-14', view: 'overview', page: 1, test: false });
  });
  it.each(['from=2026-02-30', 'from=2026-10-15', 'from=2026-10-14&to=2026-10-13', 'view=invalid', 'page=0', 'page=1.5', 'source=site-a', 'media=anything', 'device=bot', 'browser=SQL', 'from=2025-01-01', 'view=quality&from=2026-01-01'])('rejects invalid or unavailable report selection %s', (query) => {
    expect(() => parseReportFilter(url(query), now)).toThrow();
  });
  it('permits old unfiltered overview, never invents precision for empty samples', () => {
    expect(parseReportFilter(url('from=2026-01-01'), now).view).toBe('overview');
    expect(percent(0, 0)).toBeNull(); expect(percent(1, 3)).toBe(33.33);
    const values = [100, 20, 10, 30];
    expect(percentile(values, 0.5)).toBe(20); expect(percentile(values, 0.95)).toBe(100);
    expect(percentile([], 0.95)).toBeNull(); expect(values).toEqual([100, 20, 10, 30]);
  });
  it('exports a labeled current page, escapes CSV quotes and neutralizes spreadsheet formulas', () => {
    const report: AnalyticsReport = { view: 'search', from: '2026-10-01', to: '2026-10-14', generatedAt: '', timezone: 'Asia/Shanghai', enabled: true, lastEventAt: null, cards: [], trend: [], notices: [], sources: [], tables: [{ key: 'terms', title: '关键词', columns: [{ key: 'query', label: '搜索词' }], rows: [{ query: '=HYPERLINK("https://example.test")' }, { query: 'normal,"quote"\nnext' }, { query: '  +SUM(1,1)' }], total: 3, page: 1, pageSize: 20 }] };
    const csv = reportCsv(report);
    expect(csv.startsWith('\ufeff')).toBe(true); expect(csv).toContain('"当前页"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"normal,""quote""\nnext"');
    expect(csv).toContain('"\'  +SUM(1,1)"');
  });
});

describe('analytics ingest transaction', () => {
  function connection(receipts: string[], failInsert = false) {
    const query = vi.fn(async (config: { sql: string }) => {
      if (config.sql.startsWith('SELECT enabled')) return [[{ enabled: 1 }]];
      if (config.sql.startsWith('SELECT event_id')) return [receipts.map(event_id => ({ event_id }))];
      if (failInsert && config.sql.includes('INSERT IGNORE INTO analytics_events')) throw new Error('database unavailable');
      return [[]];
    });
    const c = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    vi.mocked(analyticsPool).mockReturnValue({ getConnection: async () => c } as unknown as ReturnType<typeof analyticsPool>);
    return c;
  }
  it('deduplicates a logical search even if a retry has another transport event ID', async () => {
    const c = connection([searchId]);
    const search = { ...base(), type: 'search' as const, searchId, searchStatus: 'empty' as const };
    const result = await ingestEvents(validateEvents([search, { ...search, id: crypto.randomUUID() }], now), newIdentity(visitor, undefined, true, now), { device: 'desktop', browser: 'Chrome' });
    expect(result).toEqual({ accepted: 1, duplicates: 1 });
    const receiptCall = c.query.mock.calls.find(([config]) => config.sql.includes('INSERT IGNORE INTO analytics_receipts'));
    expect(receiptCall).toBeDefined();
    expect(c.commit).toHaveBeenCalledOnce(); expect(c.rollback).not.toHaveBeenCalled(); expect(c.release).toHaveBeenCalledOnce();
  });
  it('does not rewrite already acknowledged events', async () => {
    const c = connection([]);
    const result = await ingestEvents(validateEvents([base()], now), newIdentity(visitor, undefined, true, now), { device: 'desktop', browser: 'Chrome' });
    expect(result).toEqual({ accepted: 0, duplicates: 1 });
    expect(c.query.mock.calls.some(([config]) => config.sql.includes('INSERT IGNORE INTO analytics_events'))).toBe(false);
    expect(c.commit).toHaveBeenCalledOnce();
  });
  it('rolls back receipts and releases the connection when any fact write fails', async () => {
    const c = connection([eventId], true);
    await expect(ingestEvents(validateEvents([base()], now), newIdentity(visitor, undefined, true, now), { device: 'desktop', browser: 'Chrome' })).rejects.toThrow('database unavailable');
    expect(c.commit).not.toHaveBeenCalled(); expect(c.rollback).toHaveBeenCalledOnce(); expect(c.release).toHaveBeenCalledOnce();
  });
  it('requires known promotion, matching owner and an active visit while retaining ordinary facts', async () => {
    const promotionId = crypto.randomUUID(), visitId = crypto.randomUUID();
    const identity = newIdentity(visitor, undefined, true, now);
    let owner = visitorHash(visitor, true);
    let activity = now;
    const calls: { sql: string; values: unknown[] }[] = [];
    const c = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn(async (config: { sql: string }, values: unknown[]) => {
      calls.push({ sql: config.sql, values });
      if (config.sql.startsWith('SELECT enabled')) return [[{ enabled: 1 }]];
      if (config.sql.startsWith('SELECT event_id')) return [[{ event_id: eventId }]];
      if (config.sql.startsWith('SELECT id FROM analytics_promotion_links')) return [[{ id: promotionId }]];
      if (config.sql.startsWith('SELECT visit_id')) return [[{ visit_id: visitId, link_id: promotionId, visitor_id: owner, is_test: 1, entered_at: sqlDate(now), last_activity_at: sqlDate(activity) }]];
      return [[]];
    }) };
    vi.mocked(analyticsPool).mockReturnValue({ getConnection: async () => c } as unknown as ReturnType<typeof analyticsPool>);
    async function run(at: number, link = promotionId) {
      calls.length = 0;
      await ingestEvents(validateEvents([{ ...base(), at, promotionId: link, promotionVisitId: visitId }], at), identity, { device: 'desktop', browser: 'Chrome' });
      return (calls.find(call => call.sql.includes('INSERT IGNORE INTO analytics_events'))!.values[0] as unknown[][])[0].slice(-2);
    }
    expect(await run(now)).toEqual([promotionId, visitId]);
    owner = visitorHash(crypto.randomUUID(), true);
    expect(await run(now)).toEqual(['', '']);
    owner = visitorHash(visitor, true);
    expect(await run(now, crypto.randomUUID())).toEqual(['', '']);
    activity = now - 31 * 60_000;
    expect(await run(now)).toEqual(['', '']);
    activity = now;
    expect(await run(now + 31 * 60_000)).toEqual(['', '']);
  });

});
