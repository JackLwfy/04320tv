import { afterAll, expect, test } from 'vitest';
import crypto from 'node:crypto';
import { analyticsPool } from './analytics-db';
import { ingestEvents } from './analytics-ingest';
import { newIdentity, visitorHash } from './analytics-auth';
import { validateEvents, businessDay } from './analytics-validation';
import { analyticsReport, parseReportFilter, reportCsv } from './analytics-report';
import type { RowDataPacket } from 'mysql2/promise';

const enabled = process.env.ANALYTICS_INTEGRATION === 'true';
const identity = newIdentity(crypto.randomUUID(), undefined, true);
const ids: string[] = [];
const id = () => { const value = crypto.randomUUID(); ids.push(value); return value; };
afterAll(async () => {
  if (!enabled) return;
  const pool = analyticsPool();
  const visitor = visitorHash(identity.visitor, true);
  for (const table of ['analytics_events', 'analytics_playback', 'analytics_receipts', 'analytics_visitors']) {
    await pool.query(`DELETE FROM ${table} WHERE visitor_id=? AND is_test=1`, [visitor]);
  }
  if (ids.length) await pool.query('DELETE FROM analytics_search_sources WHERE is_test=1 AND search_id IN (?)', [ids]);
  await pool.end();
});

test.skipIf(!enabled)('real TLS database: deduplication, ordered snapshots, ownership and every report', async () => {
  const now = Date.now(); const searchId = id(); const attemptId = id();
  const sourceKey = 'integration-source';
  const event = (type: string, extra = {}) => ({ id: id(), type, at: now, ...extra });
  const raw = [event('page_view', { page: '/', referrer: 'https://example.org/path?private=1' }),
    event('search', { media: 'vod', searchId, query: '=integration', searchStatus: 'success', resultCount: 1, outcomes: [{ sourceKey, sourceName: '验收片源', sourceOrigin: 'site', status: 'success', durationMs: 250, resultCount: 1 }] }),
    event('search_click', { media: 'vod', searchId, sourceKey }),
    event('playback', { media: 'vod', sourceKey, sourceName: '验收片源', sourceOrigin: 'site', attemptId, watchId: id(), searchId, startedAt: now - 60000, sequence: 2, playbackStatus: 'playing', playedMs: 40000, hiddenPlayedMs: 10000, bufferMs: 2000, bufferCount: 1, firstFrameMs: 500, firstFrameMethod: 'frame', title: '隔离验收影片', vodId: 'test', episode: 0 })];
  const events = validateEvents(raw, now);
  const dimensions = { device: 'desktop', browser: 'Chrome' };
  expect(await ingestEvents(events, identity, dimensions)).toEqual({ accepted: 4, duplicates: 0 });
  expect(await ingestEvents(events, identity, dimensions)).toEqual({ accepted: 0, duplicates: 4 });
  const stale = validateEvents([{ ...raw[3], id: id(), sequence: 1, playedMs: 10, hiddenPlayedMs: 0, playbackStatus: 'loading' }], now);
  await ingestEvents(stale, identity, dimensions);
  const regressive = validateEvents([{ ...raw[3], id: id(), sequence: 3, playedMs: 0, hiddenPlayedMs: 0, bufferMs: 50000 }], now);
  await ingestEvents(regressive, identity, dimensions);
  const foreign = newIdentity(crypto.randomUUID(), undefined, true);
  const foreignEvent = validateEvents([{ ...raw[3], id: id(), sequence: 9, playedMs: 50000, playbackStatus: 'ended' }], now);
  try {
    await ingestEvents(foreignEvent, foreign, dimensions);
    const [actual] = await analyticsPool().query<RowDataPacket[]>('SELECT * FROM analytics_playback WHERE attempt_id=?', [attemptId]);
    expect(Number(actual[0].played_ms)).toBe(40000);
    expect(Number(actual[0].sequence_no)).toBe(2);
    expect(Number(actual[0].buffer_ms)).toBe(2000);
    expect(actual[0].visitor_id).toBe(visitorHash(identity.visitor, true));
    const renewed = newIdentity(identity.visitor, undefined, true);
    await ingestEvents(validateEvents([{ ...raw[3], id: id(), sequence: 4, playedMs: 45000 }], now), renewed, dimensions);
    const [resumed] = await analyticsPool().query<RowDataPacket[]>('SELECT played_ms,session_id FROM analytics_playback WHERE attempt_id=?', [attemptId]);
    expect(Number(resumed[0].played_ms)).toBe(45000);
    expect(resumed[0].session_id).toBe(identity.session);
  } finally {
    await analyticsPool().query('DELETE FROM analytics_receipts WHERE visitor_id=? AND is_test=1', [visitorHash(foreign.visitor, true)]);
    await analyticsPool().query('DELETE FROM analytics_visitors WHERE visitor_id=? AND is_test=1', [visitorHash(foreign.visitor, true)]);
  }
  const today = businessDay();
  for (const view of ['overview','traffic','search','content','quality','newsletter','health']) {
    const report = await analyticsReport(parseReportFilter(new URL(`http://localhost?view=${view}&from=${today}&to=${today}&test=1`)));
    expect(report.view).toBe(view);
    expect(report.cards.length).toBeGreaterThan(0);
    expect(reportCsv(report)).toContain('Asia/Shanghai');
  }
  const source = events[3].sourceKey;
  for (const query of [`view=search&media=vod&source=${source}`, 'view=quality&device=desktop&browser=Chrome&page=2', 'view=overview&from=' + businessDay(now - 100 * 86400000)]) {
    const report = await analyticsReport(parseReportFilter(new URL(`http://localhost?test=1&${query}`)));
    expect(report.cards.length).toBeGreaterThan(0);
    if (query.startsWith('view=search')) {
      expect(report.cards.find(c => c.key === 'searches')?.value).toBe(1);
      expect(report.cards.find(c => c.key === 'click')?.value).toBe(100);
      expect(report.cards.find(c => c.key === 'play')?.value).toBe(100);
    }
  }
}, 90000);
