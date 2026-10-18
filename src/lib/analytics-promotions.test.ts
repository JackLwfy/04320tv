import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPromotion, parsePromotionCreate, parsePromotionFilter, parsePromotionUpdate, promotionCohort, promotionLandingPath, promotionReport, promotionsCsv } from './analytics-promotions';
import { businessDay, DAY_MS } from './analytics-validation';

const { query, execute, release } = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), release: vi.fn() }));
vi.mock('./analytics-db', () => ({ analyticsPool: () => ({ getConnection: async () => ({ query, execute, release, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() }) }) }));
beforeEach(() => { vi.stubEnv('ADMIN_ORIGIN', 'https://04320.example'); query.mockReset(); execute.mockReset(); release.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
const id = '154429b1-f3ab-4a60-b364-d55c580993c0';

describe('promotion trust boundaries', () => {
  it('keeps the destination query and hash while replacing a prior promotion', () => {
    expect(promotionLandingPath('/play?id=12&promo=old#episode')).toBe('/play?id=12#episode');
    expect(parsePromotionCreate({ name: ' 微信群 ', channel: '微信', landingPath: '/' })).toMatchObject({ name: '微信群', channel: '微信', activity: '', notes: '' });
  });
  it.each(['https://evil.example/', '//evil.example/', '/\\evil.example/', '/admin', '/admin/config', '/api/search', '/%61dmin', '/%2fadmin', '/x/../admin', '/%00admin'])('rejects unsafe landing path %s', path => {
    expect(() => promotionLandingPath(path)).toThrow();
  });
  it('keeps channel and landing page immutable and validates required fields', () => {
    expect(() => parsePromotionCreate({ name: '', channel: '微信', landingPath: '/' })).toThrow();
    expect(() => parsePromotionCreate({ name: 'test', channel: 'a\nb', landingPath: '/' })).toThrow();
    expect(() => parsePromotionUpdate({ id, channel: 'other' })).toThrow();
    expect(() => parsePromotionUpdate({ id, landingPath: '/other' })).toThrow();
    expect(() => parsePromotionUpdate({ id, archived: 'true' })).toThrow();
    expect(parsePromotionUpdate({ id, name: '已重命名', archived: true })).toEqual({ id, name: '已重命名', archived: true });
  });
  it('allows only retained cohort dates and approved ordering', () => {
    const today = businessDay(Date.now());
    expect(() => parsePromotionFilter(new URL('https://local?sort=id%20DESC'))).toThrow();
    expect(() => parsePromotionFilter(new URL('https://local?page=0'))).toThrow();
    expect(() => parsePromotionFilter(new URL(`https://local?from=${businessDay(Date.now() - 90 * DAY_MS)}&to=${today}`))).toThrow('90');
    const f = parsePromotionFilter(new URL(`https://local?id=${id}&q=%27OR%201&channel=微信`));
    const cohort = promotionCohort(f);
    expect(cohort.sql).not.toContain("'OR 1");
    expect(cohort.values).toContain("'OR 1");
    expect(cohort.sql).not.toContain('l.archived=?');
    expect(cohort.sql).toContain('e.visitor_id=v.visitor_id AND e.is_test=v.is_test');
    expect(cohort.sql).toContain('p.visitor_id=v.visitor_id AND p.is_test=v.is_test');
    expect(cohort.sql).toContain('GREATEST(p.played_ms-p.hidden_played_ms,0)');
  });
});

it('paginates in SQL without dropping zero-traffic links, and releases the connection', async () => {
  const row = { id, name: '=SUM(1,1)', channel: '微信', activity: '', placement: '', creative: '', notes: '"quoted"', landing_path: '/play?id=12', archived: 0, created_at: '2026-01-01', updated_at: '2026-01-01' };
  query.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes('COUNT(*) total')) return [[{ total: 21 }]];
    if (sql.includes('ORDER BY arrivals DESC,l.created_at')) return [[row]];
    return [[]];
  });
  const f = parsePromotionFilter(new URL('https://local?page=2'));
  const report = await promotionReport(f);
  expect(report.total).toBe(21); expect(report.page).toBe(2);
  expect(report.links[0]).toMatchObject({ visitors: 0, arrivals: 0, playRate: null, url: `https://04320.example/play?id=12&promo=${id}` });
  const page = query.mock.calls.find(([arg]) => arg.sql.includes('ORDER BY arrivals DESC,l.created_at'))!;
  expect(page[0].sql).toContain('LEFT JOIN grouped'); expect(page[0].sql).toMatch(/LIMIT \? OFFSET \?$/);
  expect(page[1].slice(-2)).toEqual([20, 20]);
  const csv = promotionsCsv(report);
  expect(csv).toContain('"\'=SUM(1,1)"'); expect(csv).toContain('""quoted""'); expect(csv).toContain('每日趋势');
  expect(release).toHaveBeenCalledOnce();
});

it('does not turn database failure into an empty report', async () => {
  query.mockRejectedValue(new Error('db unavailable'));
  await expect(promotionReport(parsePromotionFilter(new URL('https://local')))).rejects.toThrow('db unavailable');
  expect(release).toHaveBeenCalledOnce();
});

it('generates an eight-character case-sensitive URL code and retries a unique collision', async () => {
  const collision = Object.assign(new Error('Duplicate code'), { code: 'ER_DUP_ENTRY' });
  execute.mockRejectedValueOnce(collision).mockResolvedValueOnce([{}]);
  query.mockImplementation(async () => [[{ id, short_code: execute.mock.calls[1][1][1], landing_path: '/watch?id=12#ep', archived: 0 }]]);
  const result = await createPromotion({ name: '推广', channel: '微信', landingPath: '/watch?id=12#ep' });
  expect(execute).toHaveBeenCalledTimes(2);
  for (const [, values] of execute.mock.calls) expect(values[1]).toMatch(/^[A-Za-z0-9_-]{8}$/);
  expect(execute.mock.calls[0][1][1]).not.toBe(execute.mock.calls[1][1][1]);
  expect(result.id).toBe(id);
  expect(result.code).toHaveLength(8);
  expect(result.url).toBe(`https://04320.example/watch?id=12&promo=${result.code}#ep`);
  expect(release).toHaveBeenCalledOnce();
});

it('preserves uppercase codes when serializing links', async () => {
  execute.mockResolvedValue([{}]);
  query.mockResolvedValue([[{ id, short_code: 'aB1_-xZ9', landing_path: '/', archived: 0 }]]);
  expect((await createPromotion({ name: '推广', channel: '微信', landingPath: '/' })).url).toBe('https://04320.example/?promo=aB1_-xZ9');
});

it('stops code collision retries after three attempts and surfaces other database errors immediately', async () => {
  const collision = Object.assign(new Error('Duplicate code'), { code: 'ER_DUP_ENTRY' });
  execute.mockRejectedValue(collision);
  await expect(createPromotion({ name: '推广', channel: '微信', landingPath: '/' })).rejects.toBe(collision);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(query).not.toHaveBeenCalled();
  execute.mockReset().mockRejectedValue(new Error('Database unavailable'));
  await expect(createPromotion({ name: '推广', channel: '微信', landingPath: '/' })).rejects.toThrow('Database unavailable');
  expect(execute).toHaveBeenCalledOnce();
});
