import { adminGuard, adminJson } from '@/lib/admin-auth';
import { currentWeather, weatherStatus } from '@/lib/weather-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  return adminJson(weatherStatus());
}
export async function POST(req: Request) {
  const denied = adminGuard(req, true); if (denied) return denied;
  const weather = await currentWeather(30.67, 104.07);
  return adminJson({ ...weatherStatus(), weather, ok: !!weather, message: weather ? `Open-Meteo 连接成功：成都 · ${weather.text} ${weather.temp}°（可能命中缓存）。` : '暂未取得天气数据，可能是网络或免费额度限制，稍后自动重试。' });
}
