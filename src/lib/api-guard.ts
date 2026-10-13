import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from './auth';
import { isLiveEnabled } from './env-live-enabled';

/** API Route 共享守卫：空密码公开访问，启用密码后未登录返回 401。 */
export function guardRequest(req: Request): NextResponse | null {
  if (new URL(req.url).pathname.startsWith('/api/live/') && !isLiveEnabled()) {
    return NextResponse.json({ error: '直播功能已关闭' }, { status: 403 });
  }
  if (isPasswordConfigured() && !sessionFromCookieHeader(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
