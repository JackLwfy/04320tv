import { imageUploadAuthorized, readImageBody, saveNewsletterImage } from '@/lib/newsletter-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!imageUploadAuthorized(req.headers)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  let body;
  try { body = await readImageBody(req); } catch { return Response.json({ error: 'invalid image size' }, { status: 413, headers }); }
  try { return Response.json({ url: await saveNewsletterImage(body, req.headers.get('x-image-sha256') || '') }, { headers }); }
  catch { return Response.json({ error: 'image was not saved' }, { status: 503, headers }); }
}
