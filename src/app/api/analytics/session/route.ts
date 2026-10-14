import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { adminJson, adminVerified, readAdminBody } from '@/lib/admin-auth';
import { guardRequest } from '@/lib/api-guard';
import { analyticsEnabled, analyticsOrigin, createDeviceCookie, DEVICE_COOKIE, newIdentity, readDevice, signAnalyticsToken } from '@/lib/analytics-auth';
import { analyticsRateLimit } from '@/lib/analytics-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  if (!analyticsOrigin(req)) return adminJson({ error: '请求来源无效。' }, 403);
  if (!analyticsEnabled()) return adminJson({ enabled: false });
  try {
    const body = await readAdminBody(req);
    const ip = req.headers.get('eo-connecting-ip') || (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '');
    if (!isIP(ip)) return adminJson({ error: '无法核验统计请求。' }, 503);
    if (!await analyticsRateLimit(`session:${ip}`, 60)) return adminJson({ error: '请求过于频繁。' }, 429);
    const visitor = readDevice(req) || crypto.randomUUID();
    const identity = newIdentity(visitor, body?.sessionId, process.env.ANALYTICS_TEST_MODE === 'true' || (body?.test === true && adminVerified(req)));
    const response = adminJson({ enabled: true, token: signAnalyticsToken(identity), sessionId: identity.session, expiresAt: identity.expires });
    response.cookies.set(DEVICE_COOKIE, createDeviceCookie(visitor), { httpOnly: true, secure: process.env.ADMIN_ORIGIN?.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 180 * 86400 });
    return response;
  } catch { return adminJson({ error: '统计服务暂不可用。' }, 503); }
}
