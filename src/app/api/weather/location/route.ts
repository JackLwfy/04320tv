import { guardRequest } from '@/lib/api-guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = guardRequest(req); if (denied) return denied;
  return Response.json({ city: null }, { headers: { 'Cache-Control': 'no-store, private' } });
}
