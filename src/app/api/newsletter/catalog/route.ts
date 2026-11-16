import { catalogAuthorized, readCatalogBody, parseCatalogBody, listCatalog, saveCatalogLink } from '@/lib/newsletter-catalog';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (!catalogAuthorized(req.headers)) return fail('unauthorized', 401);
  let raw: Buffer;
  try { raw = await readCatalogBody(req); } catch { return fail('invalid body size', 413); }
  let body: Record<string, unknown>;
  try { body = parseCatalogBody(raw, req.headers.get('x-catalog-sha256') || ''); } catch { return fail('invalid body', 400); }
  try {
    if (body.action === 'list' && typeof body.after_rank === 'number' && Number.isSafeInteger(body.after_rank) && body.after_rank >= 0 && typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 100) {
      return Response.json(await listCatalog(body.after_rank, body.limit), { headers });
    }
    if (body.action === 'link' && typeof body.douban_id === 'string' && typeof body.source_key === 'string' && typeof body.vod_id === 'string') {
      const url = await saveCatalogLink(body.douban_id, body.source_key, body.vod_id);
      return url ? Response.json({ url }, { headers }) : fail('movie or source unavailable', 400);
    }
    return fail('invalid action or fields', 400);
  } catch { return fail('catalog unavailable', 503); }
}
