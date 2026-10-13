import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const upstream = vi.fn();
function request(email: unknown = 'viewer@example.com', headers: Record<string, string> = {}) {
  return new Request('https://04320.com/api/newsletter/subscribe', { method: 'POST', headers: { origin: 'https://04320.com', 'content-type': 'application/json', 'eo-connecting-ip': '192.0.2.20', ...headers }, body: JSON.stringify({ email }) });
}
beforeEach(() => {
  vi.stubEnv('ADMIN_ORIGIN', 'https://04320.com');
  vi.stubEnv('NEXT_PUBLIC_NEWSLETTER_ENABLED', 'true');
  vi.stubEnv('NEWSLETTER_API_URL', 'https://mail.example/public/subscribe_api.php');
  vi.stubEnv('NEWSLETTER_API_KEY', 'test-only-secret');
  upstream.mockReset(); vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('newsletter submission proxy', () => {
  it('forwards to the fixed private endpoint and reports accepted, never delivery', async () => {
    upstream.mockResolvedValue(Response.json({ status: 'accepted' }, { status: 202 }));
    const response = await POST(request(' viewer@example.com '));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'accepted' });
    const [url, init] = upstream.mock.calls[0];
    expect(url.href).toBe('https://mail.example/public/subscribe_api.php');
    expect(init.headers.Authorization).toBe('Bearer test-only-secret');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toMatchObject({ email: 'viewer@example.com', ip: '192.0.2.20' });
  });
  it('rejects cross-origin, invalid email, disabled entry and missing trusted IP without forwarding', async () => {
    expect((await POST(request('a@b.com', { origin: 'https://evil.example' }))).status).toBe(403);
    for (const email of [null, 'bad', 'a@b.com\r\nBcc: c@d.com', 'x'.repeat(255)]) expect((await POST(request(email))).status).toBe(400);
    expect((await POST(request('a@b.com', { 'eo-connecting-ip': '', 'x-forwarded-for': '192.0.2.9' }))).status).toBe(503);
    vi.stubEnv('NEXT_PUBLIC_NEWSLETTER_ENABLED', 'false');
    expect((await POST(request())).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([429, 500, 401])('does not leak upstream errors or claim success on %i', async status => {
    upstream.mockResolvedValue(Response.json({ secret: 'never-show' }, { status }));
    const response = await POST(request());
    expect(response.status).toBe(status === 429 ? 429 : 502);
    expect(await response.text()).not.toContain('never-show');
  });
  it('rejects redirects, malformed success and transport failures', async () => {
    upstream.mockResolvedValue(Response.json({ status: 'confirmed' }));
    expect((await POST(request())).status).toBe(502);
    upstream.mockRejectedValue(new Error('private details'));
    expect((await POST(request())).status).toBe(502);
    vi.stubEnv('NEWSLETTER_API_URL', 'http://insecure.example/');
    upstream.mockClear();
    expect((await POST(request())).status).toBe(502);
    expect(upstream).not.toHaveBeenCalled();
  });
});
