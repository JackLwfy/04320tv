import { guardRequest } from '@/lib/api-guard';
import { searchWeatherCities } from '@/lib/weather-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = guardRequest(req); if (denied) return denied;
  return Response.json({ cities: await searchWeatherCities(new URL(req.url).searchParams.get('q') || '') }, { headers: { 'Cache-Control': 'no-store, private' } });
}
