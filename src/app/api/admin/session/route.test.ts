import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';
import { ADMIN_COOKIE, adminVerified } from '@/lib/admin-auth';

const password = 'test-only-route-password';
const salt = 'b'.repeat(32);
const hash = `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
let ip = 0;
function req(body: string, origin = 'https://site.example', contentType = 'application/json') {
  return new Request('https://site.example/api/admin/session', { method: 'POST', body, headers: { origin, 'content-type': contentType, 'x-forwarded-for': `192.0.2.${++ip}` } });
}
beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD_HASH', hash);
  vi.stubEnv('ADMIN_SESSION_SECRET', 'test-only-route-secret');
  vi.stubEnv('ADMIN_ORIGIN', 'https://site.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('administrator session API', () => {
  it('issues a secure HTTP-only independent cookie and exposes no credentials', async () => {
    const response = await POST(req(JSON.stringify({ username: 'admin', password })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
    const cookie = response.headers.get('set-cookie')!;
    for (const attribute of [ADMIN_COOKIE, 'HttpOnly', 'Secure', 'SameSite=strict', 'Max-Age=28800']) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain(password);
    expect(cookie).not.toContain(hash);
    const readReq = new Request('https://site.example/api/admin/session', { headers: { cookie: cookie.split(';')[0] } });
    expect(adminVerified(readReq)).toBe(true);
    expect(await (await GET(readReq)).json()).toEqual({ verified: true, configured: true });
  });
  it('rejects an incorrect Origin or non-JSON body before authenticating', async () => {
    const body = JSON.stringify({ username: 'admin', password });
    expect((await POST(req(body, 'https://evil.example'))).status).toBe(403);
    expect((await POST(req(body, 'https://site.example', 'text/plain'))).status).toBe(403);
    expect((await DELETE(req('{}', 'https://evil.example'))).status).toBe(403);
  });
  it.each([null, [], {}, { username: 'admin', password: {} }, { username: 'admin', password: ['test'] }, { username: 'other', password }, { username: 'admin', password: 'wrong' }])('rejects invalid login body %#', async (body) => {
    const response = await POST(req(JSON.stringify(body)));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('rejects malformed JSON and requests exceeding the byte limit', async () => {
    expect((await POST(req('{'))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ username: 'admin', password: '中'.repeat(11000) })))).status).toBe(400);
  });
  it('clears the session on logout and reports missing setup without signing', async () => {
    const response = await DELETE(req('{}'));
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await response.json()).toEqual({ verified: false });
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    expect((await POST(req(JSON.stringify({ username: 'admin', password })))).status).toBe(503);
    expect(await (await GET(new Request('https://site.example'))).json()).toEqual({ verified: false, configured: false });
  });
});
