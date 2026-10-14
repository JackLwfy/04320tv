import crypto from 'node:crypto';
import { UUID } from './analytics-validation';

export const DEVICE_COOKIE = 'tv_analytics_device';
const TOKEN_TTL = 24 * 60 * 60 * 1000;
export interface AnalyticsIdentity { visitor: string; session: string; expires: number; test: boolean }
function secret() {
  const value = process.env.ANALYTICS_INGEST_SECRET;
  if (!value || value.length < 32) throw new Error('统计签名密钥未配置。');
  return value;
}
function signature(value: string) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function equal(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
export function visitorHash(visitor: string, test = false) { return crypto.createHmac('sha256', secret()).update(`${test ? 'test-visitor' : 'visitor'}:${visitor}`).digest('hex'); }
export function rateBucket(value: string) { return crypto.createHmac('sha256', secret()).update(`rate:${value}`).digest('hex'); }
export function createDeviceCookie(visitor: string) { return `${visitor}.${signature(`device:${visitor}`)}`; }
export function readDevice(req: Request): string | null {
  const cookie = req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1);
  if (!cookie) return null;
  const [visitor, mac, extra] = cookie.split('.');
  return extra === undefined && UUID.test(visitor || '') && typeof mac === 'string' && equal(mac, signature(`device:${visitor}`)) ? visitor : null;
}
export function signAnalyticsToken(identity: AnalyticsIdentity) {
  const body = Buffer.from(JSON.stringify(identity)).toString('base64url');
  return `${body}.${signature(`token:${body}`)}`;
}
export function verifyAnalyticsToken(value: unknown, now = Date.now()): AnalyticsIdentity | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const [body, mac, extra] = value.split('.');
    if (extra || !body || !mac || !equal(mac, signature(`token:${body}`))) return null;
    const item = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return UUID.test(item.visitor) && UUID.test(item.session) && typeof item.test === 'boolean' && Number.isSafeInteger(item.expires) && item.expires > now && item.expires <= now + TOKEN_TTL ? item : null;
  } catch { return null; }
}
export function newIdentity(visitor: string, session?: string, test = false, now = Date.now()): AnalyticsIdentity {
  return { visitor, session: typeof session === 'string' && UUID.test(session) ? session : crypto.randomUUID(), test, expires: now + TOKEN_TTL };
}
export function analyticsEnabled() { return process.env.ANALYTICS_ENABLED === 'true' && !!process.env.ANALYTICS_INGEST_SECRET; }
export function analyticsOrigin(req: Request) {
  return !!process.env.ADMIN_ORIGIN && req.headers.get('origin') === process.env.ADMIN_ORIGIN && req.headers.get('content-type')?.split(';')[0] === 'application/json';
}
