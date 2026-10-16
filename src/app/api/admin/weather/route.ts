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
  const weather = await currentWeather(39.9, 116.41);
  return adminJson({ ...weatherStatus(), weather, ok: !!weather, message: weather ? '北京天气连通测试成功（可能命中缓存）。' : '未取得天气数据，请检查配置、供应商配额或稍后重试。' });
}
