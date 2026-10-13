import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE, ADMIN_TTL, adminGuard, adminReady, adminVerified, allowAdminAttempt, checkAdminPassword, readAdminBody, sameAdminOrigin, signAdminSession } from './admin-auth';
import { SESSION_COOKIE, signSession, verifySession } from './auth';

const password = 'test-only-admin-password';
const salt = 'a'.repeat(32);
const hash = `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
const request = (token: string) => new Request('https://site.example/api/admin/config', { headers: { cookie: `${ADMIN_COOKIE}=${token}` } });
beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD_HASH', hash);
  vi.stubEnv('ADMIN_SESSION_SECRET', 'test-only-session-secret');
  vi.stubEnv('ADMIN_ORIGIN', 'https://site.example');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('independent administrator authentication', () => {
  it('checks the password hash and rejects unexpected password types', () => {
    expect(adminReady()).toBe(true);
    expect(checkAdminPassword(password)).toBe(true);
    for (const value of ['wrong', '', 'x'.repeat(257), 3, null, {}, ['password']]) expect(checkAdminPassword(value)).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD_HASH', 'malformed');
    expect(checkAdminPassword(password)).toBe(false);
  });
  it('rejects public sessions and keeps administrator tokens unusable as public sessions', () => {
    vi.stubEnv('PASSWORD', 'test-only-public-password');
    const publicToken = signSession().token;
    expect(adminVerified(new Request('https://site.example', { headers: { cookie: `${SESSION_COOKIE}=${publicToken}` } }))).toBe(false);
    expect(adminVerified(request(publicToken))).toBe(false);
    const adminToken = signAdminSession();
    expect(adminVerified(request(adminToken))).toBe(true);
    expect(verifySession(adminToken)).toBe(false);
  });
  it('expires exactly at the session deadline and rejects tampering', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    const token = signAdminSession();
    expect(adminVerified(request(token))).toBe(true);
    const [expiry, nonce, signature] = token.split('.');
    for (const bad of [`${Number(expiry) + 1}.${nonce}.${signature}`, `${expiry}.${nonce}.${'0'.repeat(64)}`, '', 'broken', `${token}extra`]) expect(adminVerified(request(bad))).toBe(false);
    vi.advanceTimersByTime(ADMIN_TTL * 1000);
    expect(adminVerified(request(token))).toBe(false);
  });
  it('invalidates sessions after password or signing-secret rotation', () => {
    const token = signAdminSession();
    vi.stubEnv('ADMIN_PASSWORD_HASH', `${salt}:${'b'.repeat(64)}`);
    expect(adminVerified(request(token))).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD_HASH', hash);
    vi.stubEnv('ADMIN_SESSION_SECRET', 'rotated-test-secret');
    expect(adminVerified(request(token))).toBe(false);
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    expect(adminReady()).toBe(false);
    expect(adminVerified(request(token))).toBe(false);
    expect(() => signAdminSession()).toThrow();
  });
  it('requires exact configured Origin and JSON for mutations', () => {
    const cookie = `${ADMIN_COOKIE}=${signAdminSession()}`;
    const req = (origin?: string, type = 'application/json') => new Request('https://site.example/api/admin/config', { headers: { cookie, ...(origin ? { origin } : {}), 'content-type': type } });
    expect(adminGuard(req('https://site.example'), true)).toBeNull();
    expect(sameAdminOrigin(req('https://site.example', 'application/json; charset=utf-8'))).toBe(true);
    for (const origin of [undefined, 'null', 'https://evil.example', 'https://site.example.evil.example']) expect(adminGuard(req(origin), true)?.status).toBe(403);
    expect(adminGuard(req('https://site.example', 'text/plain'), true)?.status).toBe(403);
    expect(adminGuard(new Request('https://site.example'))?.status).toBe(401);
  });
  it('limits login attempts for fifteen minutes', () => {
    vi.useFakeTimers();
    const req = new Request('https://site.example', { headers: { 'x-forwarded-for': '192.0.2.201' } });
    for (let i = 0; i < 5; i++) expect(allowAdminAttempt(req)).toBe(true);
    expect(allowAdminAttempt(req)).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(allowAdminAttempt(req)).toBe(true);
  });
});

describe('administrator request body limits', () => {
  const req = (body: string) => new Request('https://site.example', { method: 'POST', body });
  it('parses valid JSON and rejects malformed or absent JSON', async () => {
    await expect(readAdminBody(req('{"name":"影院"}'))).resolves.toEqual({ name: '影院' });
    await expect(readAdminBody(req('{'))).rejects.toThrow();
    await expect(readAdminBody(new Request('https://site.example'))).rejects.toThrow();
  });
  it('counts UTF-8 bytes instead of characters without trusting Content-Length', async () => {
    await expect(readAdminBody(req(JSON.stringify('a'.repeat(32766))))).resolves.toHaveLength(32766);
    await expect(readAdminBody(req(JSON.stringify('a'.repeat(32767))))).rejects.toThrow('请求内容过大');
    await expect(readAdminBody(req(JSON.stringify('中'.repeat(11000))))).rejects.toThrow('请求内容过大');
  });
});
