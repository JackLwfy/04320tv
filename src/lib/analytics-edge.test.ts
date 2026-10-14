import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../edge-functions/api/analytics/collect.js';
import { verifiedAnalyticsNetwork } from './analytics-geography';

const secret = 'edge-test-only-signing-secret-at-least-32-characters';
const origin = 'https://example.test';
function context(body: string, geo = { countryCodeAlpha2: 'CN', regionName: '广东省', regionCode: 'CN-44' }) {
  return { env: { ADMIN_ORIGIN: origin, ANALYTICS_INGEST_SECRET: secret }, request: Object.assign(new Request(origin + '/api/analytics/collect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'eo-connecting-ip': '198.51.100.9', 'x-04320-geo-country': 'ZZ', 'x-04320-network': 'forged', cookie: 'tv_auth=signed' }, body }), { eo: { clientIp: '203.0.113.7', geo } }) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('native edge network proofs', () => {
  it('reads EO context, signs the whole body, and preserves site-auth cookies', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('ANALYTICS_INGEST_SECRET', secret);
    const fetchMock = vi.fn(async () => new Response('{"accepted":1,"duplicates":0}'));
    vi.stubGlobal('fetch', fetchMock);
    const body = { token: 'signed-token', events: [{ type: 'page_view' }] };
    expect((await onRequest(context(JSON.stringify(body)))).status).toBe(200);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(origin + '/api/analytics/ingest');
    const headers = new Headers(options.headers);
    expect(headers.get('cookie')).toBe('tv_auth=signed');
    expect(headers.has('eo-connecting-ip')).toBe(false);
    expect(headers.has('x-04320-geo-country')).toBe(false);
    expect(verifiedAnalyticsNetwork(headers, body)).toEqual({ ip: '203.0.113.7', country: 'CN', province: '44' });
    expect(verifiedAnalyticsNetwork(headers, { ...body, token: 'changed' })).toBeNull();
    expect(verifiedAnalyticsNetwork(headers, body, Date.now() + 61000)).toBeNull();
    const data = JSON.parse(decodeURIComponent(headers.get('x-04320-network')!));
    headers.set('x-04320-network', encodeURIComponent(JSON.stringify({ ...data, ip: '1.2.3.4' })));
    expect(verifiedAnalyticsNetwork(headers, body)).toBeNull();
  });
  it('clears missing native geography and cannot accept an unsigned production network', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('ANALYTICS_INGEST_SECRET', secret);
    const fetchMock = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetchMock);
    await onRequest(context('{}', { countryCodeAlpha2: '', regionName: '', regionCode: '' }));
    const [, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(verifiedAnalyticsNetwork(new Headers(options.headers), {})).toEqual({ ip: '203.0.113.7', country: '', province: '' });
    expect(verifiedAnalyticsNetwork(new Headers({ 'eo-connecting-ip': '1.2.3.4', 'x-04320-geo-country': 'CN' }), {})).toBeNull();
  });
  it('rejects cross-origin, malformed, oversized and missing native-IP requests before forwarding', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const otherOrigin = context('{}'); otherOrigin.request.headers.set('Origin', 'https://evil.test');
    expect((await onRequest(otherOrigin)).status).toBe(403);
    expect((await onRequest(context('invalid'))).status).toBe(400);
    const oversized = context(JSON.stringify({ tooLarge: 'x'.repeat(32768) }));
    expect((await onRequest(oversized)).status).toBe(400);
    const missing = context('{}'); missing.request.eo.clientIp = '';
    expect((await onRequest(missing)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
