import { adminJson, readAdminBody } from '@/lib/admin-auth';
import { guardRequest } from '@/lib/api-guard';
import { analyticsEnabled, analyticsOrigin, verifyAnalyticsToken } from '@/lib/analytics-auth';
import { analyticsRateLimit, ingestEvents, recordRejected } from '@/lib/analytics-ingest';
import { clientDimensions, validateEvents } from '@/lib/analytics-validation';
import { analyticsNetwork } from '@/lib/analytics-geography';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  if (!analyticsOrigin(req)) return adminJson({ error: '请求来源无效。' }, 403);
  if (!analyticsEnabled()) return adminJson({ error: '统计采集已关闭。' }, 503);
  let body;
  try { body = await readAdminBody(req); } catch { return adminJson({ error: '统计请求格式无效。' }, 400); }
  const identity = verifyAnalyticsToken(body?.token);
  if (!identity) return adminJson({ error: '统计会话已过期。' }, 401);
  try {
    if (!await analyticsRateLimit(`collect:${identity.visitor}`, 120)) return adminJson({ error: '统计请求过于频繁。' }, 429);
    let events;
    try { events = validateEvents(body.events); }
    catch { if (!identity.test) await recordRejected(); return adminJson({ error: '统计事件无效或已过期。' }, 400); }
    const network = analyticsNetwork(req.headers);
    if (!network.ip) return adminJson({ error: '无法核验统计请求。' }, 503);
    const result = await ingestEvents(events, identity, clientDimensions(req.headers.get('user-agent') || ''), network);
    return adminJson(result);
  } catch { return adminJson({ error: '统计保存暂未确认，请稍后重试。' }, 503); }
}
