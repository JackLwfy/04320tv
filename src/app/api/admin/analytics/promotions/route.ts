import { adminGuard, adminJson, readAdminBody } from '@/lib/admin-auth';
import { analyticsConfigured } from '@/lib/analytics-db';
import { createPromotion, parsePromotionCreate, parsePromotionFilter, parsePromotionUpdate, promotionReport, promotionsCsv, updatePromotion } from '@/lib/analytics-promotions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  if (!analyticsConfigured()) return adminJson({ error: '统计数据库尚未配置。' }, 503);
  const url = new URL(req.url); let filter;
  try { filter = parsePromotionFilter(url); } catch (error) { return adminJson({ error: error instanceof Error ? error.message : '筛选无效。' }, 400); }
  try {
    const csv = url.searchParams.get('format') === 'csv';
    const report = await promotionReport(filter, csv);
    if (filter.id && !report.detail) return adminJson({ error: '推广链接不存在。' }, 404);
    if (csv) return new Response(promotionsCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="04320-promotions-${filter.from}-${filter.to}.csv"`, 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
    return adminJson(report);
  } catch { return adminJson({ error: '推广统计暂不可用，请稍后重试；这不表示访问量为零。' }, 503); }
}
async function write(req: Request, update: boolean) {
  const denied = adminGuard(req, true); if (denied) return denied;
  if (!analyticsConfigured()) return adminJson({ error: '统计数据库尚未配置。' }, 503);
  let body;
  try { body = await readAdminBody(req); if (update) parsePromotionUpdate(body); else parsePromotionCreate(body); }
  catch (error) { return adminJson({ error: error instanceof Error ? error.message : '请求内容无效。' }, 400); }
  try {
    const link = update ? await updatePromotion(body) : await createPromotion(body);
    return link ? adminJson({ link }, update ? 200 : 201) : adminJson({ error: '推广链接不存在。' }, 404);
  } catch { return adminJson({ error: '推广链接暂时无法保存，请稍后重试。' }, 503); }
}
export async function POST(req: Request) { return write(req, false); }
export async function PATCH(req: Request) { return write(req, true); }
