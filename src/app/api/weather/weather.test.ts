import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as current } from './current/route';
import { GET as cities } from './cities/route';
import { GET as location } from './location/route';
import { GET as adminStatus, POST as adminTest } from '../admin/weather/route';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('weather route guards', () => {
  it('protects all Node weather routes when the site requires login', async () => {
    vi.stubEnv('PASSWORD', 'test-only');
    for (const route of [current, cities, location]) expect((await route(new Request('https://example.test/api/weather/current?lat=1&lon=1'))).status).toBe(401);
  });
  it('requires admin authentication for diagnostics and connectivity checks', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await adminStatus(new Request('https://example.test/api/admin/weather'))).status).toBe(401);
    expect((await adminTest(new Request('https://example.test/api/admin/weather', { method: 'POST' }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects missing or out-of-range coordinates before upstream access', async () => {
    vi.stubEnv('PASSWORD', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const query of ['', '?lat=&lon=', '?lat=91&lon=1', '?lat=1&lon=181', '?lat=no&lon=1']) expect((await current(new Request(`https://example.test/api/weather/current${query}`))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
