import { catalogWatchUrl } from '@/lib/newsletter-catalog';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const url = await catalogWatchUrl((await context.params).id);
    return url ? new Response(null, { status: 302, headers: { ...headers, Location: url } }) : new Response('无效的观影链接', { status: 404, headers });
  } catch { return new Response('暂时无法打开观影链接', { status: 503, headers }); }
}
