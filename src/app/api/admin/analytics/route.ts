import { adminGuard, adminJson } from '@/lib/admin-auth';
import { analyticsConfigured } from '@/lib/analytics-db';
import { analyticsReport, parseReportFilter, reportCsv } from '@/lib/analytics-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  if (!analyticsConfigured()) return adminJson({ error: '统计数据库尚未配置。' }, 503);
  const url = new URL(req.url);
  let filter;
  try { filter = parseReportFilter(url); } catch (error) { return adminJson({ error: error instanceof Error ? error.message : '统计筛选无效。' }, 400); }
  try {
    const report = await analyticsReport(filter);
    if (url.searchParams.get('format') === 'csv') return new Response(reportCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="04320-${filter.view}-${filter.from}-${filter.to}.csv"`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
    return adminJson(report);
  } catch { return adminJson({ error: '统计暂不可用，请稍后重试；这不表示访问量为零。' }, 503); }
}
