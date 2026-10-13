import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE, signAdminSession } from '@/lib/admin-auth';
import type { Env } from '@/lib/admin-config';
import { assertProject, deployments, readCloudEnv, triggerDeployment } from '@/lib/edgeone-admin';
import { GET, POST } from './route';

vi.mock('@/lib/edgeone-admin', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/edgeone-admin')>(),
  assertProject: vi.fn(), deployments: vi.fn(), readCloudEnv: vi.fn(), triggerDeployment: vi.fn(),
}));
function request(authenticated = true, origin = 'https://site.example') {
  return new Request('https://site.example/api/admin/deployments', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(authenticated ? { cookie: `${ADMIN_COOKIE}=${signAdminSession()}` } : {}) } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ADMIN_PASSWORD_HASH', `${'a'.repeat(32)}:${'b'.repeat(64)}`);
  vi.stubEnv('ADMIN_SESSION_SECRET', 'test-only-secret');
  vi.stubEnv('ADMIN_ORIGIN', 'https://site.example');
  vi.stubEnv('ADMIN_CONFIG_REVISION', 'deployed-old');
  vi.mocked(deployments).mockResolvedValue([]);
  vi.mocked(readCloudEnv).mockResolvedValue({ entries: [], values: { ADMIN_CONFIG_REVISION: 'pending-new' } });
  vi.mocked(triggerDeployment).mockResolvedValue('new-deployment');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('administrator deployment API', () => {
  it('rejects missing sessions and untrusted Origins before accessing the cloud', async () => {
    expect((await GET(request(false))).status).toBe(401);
    expect((await POST(request(false))).status).toBe(401);
    expect((await POST(request(true, 'https://evil.example'))).status).toBe(403);
    for (const fn of [assertProject, deployments, readCloudEnv, triggerDeployment]) expect(fn).not.toHaveBeenCalled();
  });
  it('returns current records and the deployed revision', async () => {
    const records = [{ id: 'complete', status: 'Success', date: '', commit: 'abc1234', message: 'release', branch: 'main' }];
    vi.mocked(deployments).mockResolvedValue(records);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records, deployedRevision: 'deployed-old' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['Building', 'Queued', 'Deploying', 'UnknownNewStatus'])('reuses an active %s deployment instead of submitting a duplicate', async (status) => {
    vi.mocked(deployments).mockResolvedValue([{ id: 'already-active', status, date: '', commit: '', message: '', branch: 'main' }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deploymentId: 'already-active' });
    expect(readCloudEnv).not.toHaveBeenCalled();
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it.each<Env>([{}, { ADMIN_CONFIG_REVISION: 'deployed-old' }])('does not redeploy when no new configuration is pending: %j', async (values) => {
    vi.mocked(readCloudEnv).mockResolvedValue({ entries: [], values });
    expect((await POST(request())).status).toBe(409);
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it('retries deployment for a saved revision that has not reached the runtime', async () => {
    vi.mocked(deployments).mockResolvedValue([{ id: 'failed', status: 'Failed', date: '', commit: '', message: '', branch: 'main' }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deploymentId: 'new-deployment' });
    expect(assertProject).toHaveBeenCalledTimes(1);
    expect(triggerDeployment).toHaveBeenCalledTimes(1);
  });
  it('reports deployment submission failure without claiming success', async () => {
    vi.mocked(triggerDeployment).mockRejectedValue(new Error('submission failed'));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'submission failed' });
  });
});
