import { adminGuard, adminJson } from '@/lib/admin-auth';
import { analyticsConfigured, analyticsConnectionHealth } from '@/lib/analytics-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  if (!analyticsConfigured()) return adminJson({ connected: false, error: '统计数据库尚未配置。' }, 503);
  try { return adminJson(await analyticsConnectionHealth()); }
  catch { return adminJson({ connected: false, error: '统计数据库连接失败，请检查网络、证书和连接额度。' }, 503); }
}
