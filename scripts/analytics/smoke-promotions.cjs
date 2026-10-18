// Operator acceptance: isolated visitor facts and uniquely named temporary links only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const privateDir = path.resolve(__dirname, '../../../.04320-analytics-private');
const origin = process.argv[2] || 'https://04320.com';
if (!['https://04320.com', 'http://localhost:8080'].includes(origin)) throw new Error('Unexpected acceptance target');
const db = JSON.parse(fs.readFileSync(path.join(privateDir, 'connection.json'), 'utf8'));
const values = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(privateDir, 'edgeone-env-before.json'), 'utf8')).map(e => [e.Key, e.Value]));
const nonce = `${Date.now() + 3600000}.${crypto.randomBytes(16).toString('hex')}`;
const mac = crypto.createHmac('sha256', `${values.ADMIN_SESSION_SECRET}:${values.ADMIN_PASSWORD_HASH}`).update(nonce).digest('hex');
const cookie = `tv_admin_session=${nonce}.${mac}`;
const activity = '__QA_PROMOTIONS_' + crypto.randomUUID();
const links = []; const identities = [];
async function request(route, body, method = 'GET', admin = true) {
  return fetch(origin + route, { method, headers: { ...(admin ? { Cookie: cookie } : {}), ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
}
async function json(response, status = 200) {
  assert.equal(response.status, status, `HTTP ${response.status}: ${response.ok ? '' : await response.text()}`);
  return response.json();
}
async function main() {
  const endpoint = '/api/admin/analytics/promotions';
  assert.equal((await request(endpoint, null, 'GET', false)).status, 401);
  assert.equal((await request(endpoint, { name: 'x', channel: 'x', landingPath: 'https://example.org/' }, 'POST')).status, 400);
  assert.equal((await fetch(origin + endpoint, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://invalid.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  for (const name of ['A', 'B']) {
    const created = await json(await request(endpoint, { name: activity + name, channel: '隔离验收', activity, placement: name, landingPath: '/?utm_source=qa#part' }, 'POST'), 201);
    links.push(created.link.id);
    assert.equal(new URL(created.link.url).searchParams.get('promo'), created.link.id);
    assert.equal(new URL(created.link.url).searchParams.get('utm_source'), 'qa');
    assert.equal(new URL(created.link.url).hash, '#part');
  }
  assert.equal((await request(endpoint, { id: links[0], channel: 'changed' }, 'PATCH')).status, 400);
  const auth = await json(await request('/api/analytics/session', { test: true }, 'POST'));
  const identity = JSON.parse(Buffer.from(auth.token.split('.')[0], 'base64url').toString());
  assert.equal(identity.test, true); identities.push(identity);
  const visit = crypto.randomUUID(); const now = Date.now(); const entered = now - 90000;
  const event = (type, extra = {}) => ({ id: crypto.randomUUID(), type, at: now, promotionId: links[0], promotionVisitId: visit, ...extra });
  const events = [event('promotion_entry', { id: visit, at: entered }), event('page_view'), event('search', { searchId: crypto.randomUUID(), query: activity, searchStatus: 'empty' }), event('newsletter_accepted'), event('playback', { attemptId: crypto.randomUUID(), watchId: crypto.randomUUID(), startedAt: entered + 1, media: 'vod', sourceKey: 'qa-promotion', title: activity, vodId: 'qa', sequence: 1, playbackStatus: 'playing', playedMs: 70000, hiddenPlayedMs: 5000, firstFrameMs: 200, firstFrameMethod: 'frame' })];
  assert.deepEqual(await json(await request('/api/analytics/collect', { token: auth.token, events }, 'POST')), { accepted: 5, duplicates: 0 });
  assert.deepEqual(await json(await request('/api/analytics/collect', { token: auth.token, events }, 'POST')), { accepted: 0, duplicates: 5 });
  const filter = `?test=1&activity=${activity}&archived=all`;
  const report = await json(await request(endpoint + filter));
  assert.equal(report.links.length, 2);
  assert.equal(report.summary.arrivals, 1);
  assert.equal(report.summary.visitors, 1);
  assert.equal(report.summary.views, 1);
  assert.equal(report.summary.playRate, 100);
  assert.equal(report.summary.effectiveDevices, 1);
  assert.equal(report.summary.watchMs, 65000);
  assert.equal(report.summary.newsletterDevices, 1);
  assert.equal(report.links.find(link => link.id === links[1]).arrivals, 0);
  const detail = await json(await request(endpoint + filter + '&id=' + links[0]));
  assert.equal(detail.detail.searches[0].emptyResults, 1);
  assert.equal(detail.detail.content[0].watchMs, 65000);
  const csv = await request(endpoint + filter + '&id=' + links[0] + '&format=csv');
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.ok(text.includes('每日趋势') && text.includes('搜索关键词') && text.includes('65000'));
  assert.equal((await json(await request(endpoint + filter + '&device=mobile'))).summary.arrivals, 0);
  assert.equal((await json(await request(endpoint + filter + '&page=2'))).links.length, 0);
  if (origin.startsWith('https:')) assert.equal((await json(await request(endpoint + `?activity=${activity}&archived=all`))).summary.arrivals, 0, 'Test facts must not enter production reports');
  await json(await request(endpoint, { id: links[0], archived: true, notes: 'isolated acceptance' }, 'PATCH'));
  assert.equal((await json(await request(endpoint + filter + '&id=' + links[0]))).detail.link.archived, true);
  console.log('PROMOTION_ACCEPTANCE_OK', origin, 'auth/origin/create/immutable/attribution/dedupe/foreground/cohort/zero-traffic/filter/page/detail/CSV/archive');
}
async function cleanup() {
  if (!links.length && !identities.length) return;
  const c = await mysql.createConnection({ host: 'mail.fafamail.com', stream: net.createConnection({ host: db.host, port: db.port }), user: db.user, password: db.password, database: db.database, ssl: { ca: db.ca, rejectUnauthorized: true, verifyIdentity: true } });
  try {
    for (const identity of identities) {
      const visitor = crypto.createHmac('sha256', db.ingestSecret).update(`test-visitor:${identity.visitor}`).digest('hex');
      for (const table of ['analytics_events', 'analytics_playback', 'analytics_promotion_visits', 'analytics_visitors', 'analytics_receipts']) await c.query(`DELETE FROM ${table} WHERE is_test=1 AND visitor_id=?`, [visitor]);
    }
    if (links.length) await c.query('DELETE FROM analytics_promotion_links WHERE id IN (?) AND activity=?', [links, activity]);
    console.log('PROMOTION_ISOLATED_TEST_DATA_REMOVED');
  } finally { await c.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => cleanup().catch(() => { console.error('Isolated cleanup failed; inspect operator run'); process.exitCode = 1; }));
