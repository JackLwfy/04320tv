// Explicit operator-only acceptance against isolated test data. Never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const privateDir = path.resolve(__dirname, '../../../.04320-analytics-private');
const origin = process.argv[2] || 'https://04320.com';
if (!['https://04320.com', 'http://localhost:8080'].includes(origin)) throw new Error('Unexpected acceptance target');
const credentials = JSON.parse(fs.readFileSync(path.join(privateDir, 'connection.json'), 'utf8'));
const values = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(privateDir, 'edgeone-env-before.json'), 'utf8')).map(e => [e.Key, e.Value]));
const value = `${Date.now() + 3600000}.${crypto.randomBytes(16).toString('hex')}`;
const signature = crypto.createHmac('sha256', `${values.ADMIN_SESSION_SECRET}:${values.ADMIN_PASSWORD_HASH}`).update(value).digest('hex');
const adminCookie = `tv_admin_session=${value}.${signature}`;
const eventIds = [];
let identity;
async function request(route, body, cookie = adminCookie, headers = {}) {
  const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  return response;
}
async function main() {
  assert.equal((await request('/api/admin/analytics', null, '')).status, 401);
  assert.equal((await request('/api/analytics/session', {}, '', { Origin: 'https://invalid.example' })).status, 403);
  const sessionResponse = await request('/api/analytics/session', { test: true });
  assert.equal(sessionResponse.status, 200, 'Session HTTP status');
  const session = await sessionResponse.json();
  assert.equal(session.enabled, true, 'Collection must be enabled');
  identity = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString());
  assert.equal(identity.test, true, 'Acceptance must never write production facts');
  const now = Date.now(); const searchId = crypto.randomUUID(); eventIds.push(searchId);
  const event = (type, extra = {}) => ({ id: crypto.randomUUID(), type, at: now, ...extra });
  const events = [event('page_view', { page: '/' }), event('search', { media: 'vod', searchId, query: 'QA-isolated', searchStatus: 'success', resultCount: 1 }), event('search_click', { media: 'vod', searchId }), event('playback', { media: 'vod', sourceKey: 'acceptance-smoke', sourceName: '验收测试', attemptId: crypto.randomUUID(), watchId: crypto.randomUUID(), searchId, startedAt: now - 60000, sequence: 1, playbackStatus: 'ended', playedMs: 40000, firstFrameMs: 450, firstFrameMethod: 'frame', title: 'QA-isolated', vodId: 'test', episode: 0 })];
  const response = await request('/api/analytics/collect', { token: session.token, events });
  assert.equal(response.status, 200, 'Collect HTTP status');
  assert.deepEqual(await response.json(), { accepted: 4, duplicates: 0 });
  const duplicate = await request('/api/analytics/collect', { token: session.token, events });
  assert.deepEqual(await duplicate.json(), { accepted: 0, duplicates: 4 });
  assert.equal((await request('/api/analytics/collect', { token: 'invalid', events })).status, 401);
  assert.equal((await request('/api/analytics/collect', { token: session.token, events: [{ ...events[0], type: 'invalid' }] })).status, 400);
  for (const view of ['overview', 'traffic', 'search', 'content', 'quality', 'newsletter', 'health']) {
    const started = Date.now();
    const reportResponse = await request(`/api/admin/analytics?test=1&view=${view}`);
    assert.equal(reportResponse.status, 200, `Report ${view}`);
    const report = await reportResponse.json();
    assert.equal(report.view, view); assert.ok(report.cards.length);
    console.log('REPORT_OK', view, `${Date.now() - started}ms`, report.tables.length, 'tables');
  }
  const csv = await request('/api/admin/analytics?test=1&view=search&format=csv');
  assert.equal(csv.status, 200); assert.ok((await csv.text()).includes('QA-isolated'));
  assert.equal((await request('/api/admin/analytics?view=invalid')).status, 400);
  if (process.argv.includes('--load')) {
    const times = []; let completed = 0; let retries = 0;
    const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
      for (let batch = 0; batch < 5; batch++) {
        const started = Date.now();
        const body = { token: session.token, events: Array.from({ length: 20 }, () => ({ ...event('page_view', { page: '/' }), at: Date.now() })) };
        let response = await request('/api/analytics/collect', body);
        for (let retry = 0; response.status === 503 && retry < 5; retry++) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
          response = await request('/api/analytics/collect', body);
        }
        assert.equal(response.status, 200, 'Small concurrent acceptance');
        assert.equal((await response.json()).accepted, 20);
        times.push(Date.now() - started); completed++;
      }
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    times.sort((a, b) => a - b);
    console.log('BOUNDED_LOAD_OK', completed, 'batches', 'concurrency=4', 'events=400', `retries=${retries}`, `p95=${times[Math.ceil(times.length * 0.95) - 1]}ms`);
  }
  console.log('ACCEPTANCE_OK', origin, 'auth/origin/validation/deduplication/7reports/CSV');
}
async function cleanup() {
  if (!identity) return;
  const c = await mysql.createConnection({ host: 'mail.fafamail.com', stream: net.createConnection({ host: credentials.host, port: credentials.port }), user: credentials.user, password: credentials.password, database: credentials.database, ssl: { ca: credentials.ca, rejectUnauthorized: true, verifyIdentity: true } });
  try {
    const visitor = crypto.createHmac('sha256', credentials.ingestSecret).update(`test-visitor:${identity.visitor}`).digest('hex');
    for (const table of ['analytics_events', 'analytics_playback', 'analytics_visitors', 'analytics_receipts']) await c.query(`DELETE FROM ${table} WHERE is_test=1 AND visitor_id=?`, [visitor]);
    if (eventIds.length) await c.query('DELETE FROM analytics_search_sources WHERE is_test=1 AND search_id IN (?)', [eventIds]);
    console.log('ISOLATED_TEST_DATA_REMOVED');
  } finally { await c.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
