import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), configured: vi.fn(), health: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ adminGuard: mocks.guard, adminJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/analytics-db', () => ({ analyticsConfigured: mocks.configured, analyticsConnectionHealth: mocks.health }));
import { GET } from './route';

describe('analytics database health', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); });
  it('does not connect for an unauthenticated request', async () => {
    mocks.guard.mockReturnValue(Response.json({}, { status: 401 }));
    expect((await GET(new Request('https://04320.com/api/admin/analytics/health'))).status).toBe(401);
    expect(mocks.health).not.toHaveBeenCalled();
  });
  it('reports the verified TLS result', async () => {
    mocks.health.mockResolvedValue({ connected: true, encrypted: true });
    expect(await (await GET(new Request('https://04320.com'))).json()).toEqual({ connected: true, encrypted: true });
  });
  it('does not leak database errors or credentials', async () => {
    mocks.health.mockRejectedValue(new Error('password=private-secret'));
    const response = await GET(new Request('https://04320.com'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-secret');
  });
});
