import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { adminJson, readAdminBody } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!process.env.ADMIN_ORIGIN || req.headers.get('origin') !== process.env.ADMIN_ORIGIN || req.headers.get('content-type')?.split(';')[0] !== 'application/json') return adminJson({ error: '请求来源无效。' }, 403);
  if (process.env.NEXT_PUBLIC_NEWSLETTER_ENABLED !== 'true' || !process.env.NEWSLETTER_API_URL || !process.env.NEWSLETTER_API_KEY) return adminJson({ error: '订阅服务暂未开放。' }, 503);
  let body;
  try { body = await readAdminBody(req); } catch { return adminJson({ error: '请求内容无效。' }, 400); }
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n]/.test(email)) return adminJson({ error: '请输入有效的邮箱地址。' }, 400);
  // EdgeOne 覆写的连接地址用于共享限流，不信任访客传入的 X-Forwarded-For 首项。
  const ip = req.headers.get('eo-connecting-ip')?.trim() || '';
  if (!isIP(ip)) return adminJson({ error: '暂时无法核验请求，请稍后重试。' }, 503);
  try {
    const endpoint = new URL(process.env.NEWSLETTER_API_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Invalid endpoint');
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEWSLETTER_API_KEY}` },
      body: JSON.stringify({ email, ip, user_agent: (req.headers.get('user-agent') || '').slice(0, 300), request_id: crypto.randomUUID() }),
    });
    if (response.status === 429) return adminJson({ error: '提交过于频繁，请稍后再试。' }, 429);
    if (!response.ok) return adminJson({ error: '暂时未能完成订阅，请稍后重试。' }, 502);
    const result = await response.json();
    if (result.status !== 'accepted') return adminJson({ error: '订阅结果尚未确认，请稍后重试。' }, 502);
    return adminJson({ status: 'accepted' }, 202);
  } catch { return adminJson({ error: '订阅结果尚未确认，请稍后重试。' }, 502); }
}
