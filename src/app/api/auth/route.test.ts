import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { GET as status } from '@/app/api/status/route';
import { guardRequest } from '@/lib/api-guard';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

beforeEach(() => { vi.stubEnv('PASSWORD', 'test-access-password'); vi.stubEnv('LIVE_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });
const request = (body: unknown) => new Request('https://site.example/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('optional website access password', () => {
  it.each(['', undefined])('permits public access for PASSWORD=%s without issuing a login cookie', async (value) => {
    vi.stubEnv('PASSWORD', value);
    const req = new Request('https://site.example/api/search');
    expect(guardRequest(req)).toBeNull();
    expect(await (await status(req)).json()).toMatchObject({ passwordRequired: false, verified: true });
    expect(await (await GET(req)).json()).toMatchObject({ verified: true });
    const login = await POST(request({}));
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toBeNull();
    vi.stubEnv('LIVE_ENABLED', 'false');
    expect(guardRequest(new Request('https://site.example/api/live/playlist'))?.status).toBe(403);
  });
  it('requires authentication after enabling a password and accepts the correct login', async () => {
    const req = new Request('https://site.example/api/search');
    expect(guardRequest(req)?.status).toBe(401);
    expect(await (await status(req)).json()).toMatchObject({ passwordRequired: true, verified: false });
    expect(await (await GET(req)).json()).toMatchObject({ verified: false });
    expect((await POST(request({ password: 'wrong' }))).status).toBe(401);
    const login = await POST(request({ password: 'test-access-password' }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect(guardRequest(new Request(req.url, { headers: { cookie } }))).toBeNull();
  });
  it('password rotation immediately invalidates old sessions across status and guarded APIs', async () => {
    vi.stubEnv('PROXY_SECRET', 'test-fixed-proxy-secret');
    const cookie = `${SESSION_COOKIE}=${signSession().token}`;
    const req = new Request('https://site.example/api/search', { headers: { cookie } });
    expect(guardRequest(req)).toBeNull();
    vi.stubEnv('PASSWORD', 'rotated-access-password');
    expect(guardRequest(req)?.status).toBe(401);
    expect(await (await status(req)).json()).toMatchObject({ passwordRequired: true, verified: false });
    expect(await (await GET(req)).json()).toMatchObject({ verified: false });
  });
  it.each([null, {}, { password: 3 }, { password: [] }, { password: 'x'.repeat(1001) }, { password: '中'.repeat(334) }])('rejects invalid password types and byte length: %#', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });
  it('accepts a password at the platform 1000-byte boundary instead of imposing a 256-character limit', async () => {
    const password = '中'.repeat(333) + 'x';
    vi.stubEnv('PASSWORD', password);
    expect((await POST(request({ password }))).status).toBe(200);
  });
});
