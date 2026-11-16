import { IMAGE_NAME, loadNewsletterImage } from '@/lib/newsletter-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!IMAGE_NAME.test(name)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    const image = await loadNewsletterImage(name);
    if (!image) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const headers = { 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': `"${image.hash}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };
    if (req.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(image.body, { headers: { ...headers, 'Content-Length': String(image.body.byteLength) } });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
