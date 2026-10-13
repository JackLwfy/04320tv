import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onUnauthorized } from './client-api';

afterEach(() => { vi.unstubAllGlobals(); });

describe('authentication error handling', () => {
  it('does not open a login/setup dialog for an unrelated service outage', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '上游服务暂不可用' }), { status: 503 })));
    await expect(api.status()).rejects.toMatchObject({ status: 503, message: '上游服务暂不可用' });
    await expect(api.search('test', [], true, { onSource: vi.fn() })).rejects.toMatchObject({ status: 503 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('continues opening access authentication for a 401 response', async () => {
    vi.stubGlobal('window', new EventTarget());
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(api.status()).rejects.toMatchObject({ status: 401, message: '需要登录' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
