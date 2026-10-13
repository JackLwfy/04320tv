import { ADMIN_COOKIE, ADMIN_TTL, adminJson, adminReady, adminVerified, allowAdminAttempt, checkAdminPassword, readAdminBody, sameAdminOrigin, signAdminSession } from '@/lib/admin-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) { return adminJson({ verified: adminVerified(req), configured: adminReady() }); }
export async function POST(req: Request) {
  if (!sameAdminOrigin(req)) return adminJson({ error: '请求来源无效。' }, 403);
  if (!adminReady()) return adminJson({ error: '管理员认证尚未配置。' }, 503);
  if (!allowAdminAttempt(req)) return adminJson({ error: '登录尝试过多，请 15 分钟后再试。' }, 429);
  let body;
  try { body = await readAdminBody(req); } catch { return adminJson({ error: '请求格式无效。' }, 400); }
  if (body?.username !== 'admin' || !checkAdminPassword(body?.password)) return adminJson({ error: '账号或密码错误。' }, 401);
  const response = adminJson({ verified: true });
  response.cookies.set(ADMIN_COOKIE, signAdminSession(), { httpOnly: true, secure: process.env.ADMIN_ORIGIN?.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: ADMIN_TTL });
  return response;
}
export async function DELETE(req: Request) {
  if (!sameAdminOrigin(req)) return adminJson({ error: '请求来源无效。' }, 403);
  const response = adminJson({ verified: false });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: process.env.ADMIN_ORIGIN?.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
