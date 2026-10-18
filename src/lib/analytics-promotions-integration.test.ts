import crypto from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';
import { newIdentity, visitorHash } from './analytics-auth';
import { ingestEvents } from './analytics-ingest';
import { businessDay, validateEvents } from './analytics-validation';
import { createPromotion, updatePromotion, parsePromotionFilter, promotionReport, promotionsCsv } from './analytics-promotions';

const enabled = process.env.ANALYTICS_INTEGRATION === 'true';
const links: string[] = [];
const identities = [newIdentity(crypto.randomUUID(), undefined, true), newIdentity(crypto.randomUUID(), undefined, true)];
const activity = '__QA_' + crypto.randomUUID();
afterAll(async () => {
  if (!enabled) return;
  const pool = analyticsPool();
  try {
    for (const identity of identities) for (const table of ['analytics_events', 'analytics_playback', 'analytics_receipts', 'analytics_promotion_visits', 'analytics_visitors']) {
      await pool.query(`DELETE FROM ${table} WHERE visitor_id=? AND is_test=1`, [visitorHash(identity.visitor, true)]);
    }
    if (links.length) await pool.query('DELETE FROM analytics_promotion_links WHERE id IN (?) AND activity=?', [links, activity]);
  } finally { await pool.end(); }
});

test.skipIf(!enabled)('promotion TLS database: cohort, visit retry, owner, cross-link, foreground watching and export', async () => {
  const a = await createPromotion({ name: '=QA-A', channel: activity, activity, landingPath: '/?q=existing#part' }); links.push(a.id);
  const b = await createPromotion({ name: 'QA-B', channel: activity, activity, landingPath: '/about' }); links.push(b.id);
  const zero = await createPromotion({ name: 'QA-ZERO', channel: activity, activity, landingPath: '/' }); links.push(zero.id);
  expect(new URL(a.url).searchParams.get('q')).toBe('existing');
  expect(new URL(a.url).searchParams.get('promo')).toBe(a.id);
  const now = Date.now(); const entered = now - 120000;
  const visitA = crypto.randomUUID(); const visitB = crypto.randomUUID(); const attempt = crypto.randomUUID();
  const dimensions = { device: 'desktop', browser: 'Chrome' };
  const raw = (type: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, at: entered, promotionId: a.id, promotionVisitId: visitA, ...extra });
  const entry = raw('promotion_entry', { id: visitA });
  const play = raw('playback', { at: now, startedAt: entered + 1000, attemptId: attempt, watchId: crypto.randomUUID(), sequence: 1, media: 'vod', sourceKey: 'qa-promotion', vodId: 'qa', title: 'QA', playbackStatus: 'playing', playedMs: 80000, hiddenPlayedMs: 20000, firstFrameMs: 100, firstFrameMethod: 'frame' });
  const send = (events: unknown[], owner = identities[0]) => ingestEvents(validateEvents(events, now), owner, dimensions, { ip: '192.0.2.120', country: 'CN', province: '44', city: 'QA' });
  const first = [entry, raw('page_view'), raw('search', { searchId: crypto.randomUUID(), query: 'QA-promotion', searchStatus: 'empty' }), raw('newsletter_impression'), raw('newsletter_submit'), raw('newsletter_accepted'), play];
  expect(await send(first)).toEqual({ accepted: 7, duplicates: 0 });
  expect(await send(first)).toEqual({ accepted: 0, duplicates: 7 });
  await send([raw('promotion_entry', { id: visitB, promotionId: b.id, promotionVisitId: visitB, at: entered + 5000 }), raw('page_view', { promotionId: b.id, promotionVisitId: visitB, at: entered + 5001 })]);
  // A forged owner must retain ordinary analytics while losing promotion credit.
  const forged = raw('newsletter_accepted', { at: now });
  await send([forged], identities[1]);
  const [stored] = await analyticsPool().query<RowDataPacket[]>('SELECT promotion_id FROM analytics_events WHERE event_id=?', [forged.id]);
  expect(stored[0].promotion_id).toBe('');
  await send([{ ...play, id: crypto.randomUUID(), sequence: 2, promotionId: b.id, promotionVisitId: visitB, playedMs: 85000 }]);
  const [snapshot] = await analyticsPool().query<RowDataPacket[]>('SELECT promotion_id,promotion_visit_id,played_ms FROM analytics_playback WHERE attempt_id=?', [attempt]);
  expect(snapshot[0]).toMatchObject({ promotion_id: a.id, promotion_visit_id: visitA });
  expect(Number(snapshot[0].played_ms)).toBe(85000);
  const filter = (suffix = '') => {
    const url = new URL(`https://04320.com/?test=1&from=${businessDay(entered)}&to=${businessDay()}&activity=${activity}&archived=all`);
    for (const [key, value] of new URLSearchParams(suffix.replace(/^&/, ''))) url.searchParams.set(key, value);
    return parsePromotionFilter(url);
  };
  const report = await promotionReport(filter());
  expect(report.summary).toMatchObject({ arrivals: 2, visitors: 1, newVisitors: 1, searchDevices: 1, playingDevices: 1, playRate: 100, watchMs: 65000, newsletterDevices: 1, effectiveDevices: 1 });
  expect(report.links).toHaveLength(3);
  expect(report.links.find(row => row.id === zero.id)?.arrivals).toBe(0);
  expect(report.links.find(row => row.id === b.id)).toMatchObject({ visitors: 1, newVisitors: 0, playingDevices: 0 });
  const detail = await promotionReport(filter('&id=' + a.id));
  expect(detail.detail?.searches).toContainEqual(expect.objectContaining({ query: 'QA-promotion', searches: 1, emptyResults: 1 }));
  expect(detail.detail?.newsletter).toMatchObject({ acceptedDevices: 1 });
  expect(promotionsCsv(report)).toContain("'=QA-A");
  expect((await promotionReport(filter('&device=mobile'))).summary.arrivals).toBe(0);
  expect((await promotionReport(filter('&page=2'))).links).toEqual([]);
  await updatePromotion({ id: a.id, archived: true, name: 'QA-A-archived' });
  expect((await promotionReport(filter('&archived=0'))).links.some(row => row.id === a.id)).toBe(false);
  expect((await promotionReport(filter('&id=' + a.id))).detail?.link.archived).toBe(true);
}, 120000);
