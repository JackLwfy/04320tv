import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export const ADMIN_COOKIE = 'tv_admin_session';
export const ADMIN_TTL = 8 * 60 * 60;
export function adminReady() { return !!process.env.ADMIN_PASSWORD_HASH && !!process.env.ADMIN_SESSION_SECRET; }
export function checkAdminPassword(password: unknown) {
  if (typeof password !== 'string' || password.length > 256 || !adminReady()) return false;
  const [salt, hash] = (process.env.ADMIN_PASSWORD_HASH || '').split(':');
  if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 32), Buffer.from(hash, 'hex'));
}
function signature(value: string) {
  return crypto.createHmac('sha256', `${process.env.ADMIN_SESSION_SECRET}:${process.env.ADMIN_PASSWORD_HASH}`).update(value).digest('hex');
}
export function signAdminSession() {
  if (!adminReady()) throw new Error('管理员认证尚未配置');
  const value = `${Date.now() + ADMIN_TTL * 1000}.${crypto.randomBytes(16).toString('hex')}`;
  return `${value}.${signature(value)}`;
}
export function adminVerified(req: Request) {
  if (!adminReady()) return false;
  const token = req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  if (!token || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expiry, nonce, mac] = token.split('.');
  return Number(expiry) > Date.now() && Number(expiry) <= Date.now() + ADMIN_TTL * 1000 && crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(`${expiry}.${nonce}`), 'hex'));
}
export function adminJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
}
export function sameAdminOrigin(req: Request) {
  const allowed = process.env.ADMIN_ORIGIN;
  return !!allowed && req.headers.get('origin') === allowed && req.headers.get('content-type')?.split(';')[0] === 'application/json';
}
export function adminGuard(req: Request, write = false) {
  if (!adminVerified(req)) return adminJson({ error: '管理员会话已过期，请重新登录。' }, 401);
  if (write && !sameAdminOrigin(req)) return adminJson({ error: '请求来源无效。' }, 403);
  return null;
}
// shortcut: 限流为实例内保护；若开放多管理员或遇到分布式攻击，升级为网关统一限流。
const attempts = new Map<string, { count: number; until: number }>();
export function allowAdminAttempt(req: Request) {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key);
  if (attempts.size > 10000) return false;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const item = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  item.count += 1; attempts.set(ip, item);
  return item.count <= 5;
}
export async function readAdminBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('请求内容为空');
  let body = ''; let bytes = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024) { await reader.cancel(); throw new Error('请求内容过大'); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}
