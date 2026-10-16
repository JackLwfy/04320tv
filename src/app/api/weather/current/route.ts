import { guardRequest } from '@/lib/api-guard';
import { currentWeather } from '@/lib/weather-server';
import { validWeatherCoordinates } from '@/lib/weather';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = guardRequest(req); if (denied) return denied;
  const query = new URL(req.url).searchParams;
  const lat = query.get('lat')?.trim(); const lon = query.get('lon')?.trim();
  if (!lat || !lon || !validWeatherCoordinates(Number(lat), Number(lon))) return Response.json({ weather: null, error: '城市坐标无效' }, { status: 400 });
  return Response.json({ weather: await currentWeather(Number(lat), Number(lon)) }, { headers: { 'Cache-Control': 'no-store, private' } });
}
