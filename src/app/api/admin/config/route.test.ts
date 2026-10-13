import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE, signAdminSession } from '@/lib/admin-auth';
import { configRevision, managedKeys, type Env } from '@/lib/admin-config';
import { initialSettings } from '@/lib/admin-settings';
import { assertProject, deployments, readCloudEnv, triggerDeployment, writeCloudEnv } from '@/lib/edgeone-admin';
import { GET, POST } from './route';

vi.mock('@/lib/edgeone-admin', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/edgeone-admin')>(),
  assertProject: vi.fn(), deployments: vi.fn(), readCloudEnv: vi.fn(), triggerDeployment: vi.fn(), writeCloudEnv: vi.fn(),
}));

let cloud: Env;
const privateKeys = ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'EDGEONE_API_TOKEN', 'PASSWORD'];
function request(body?: unknown, authenticated = true, origin = 'https://site.example') {
  return new Request('https://site.example/api/admin/config', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...(authenticated ? { cookie: `${ADMIN_COOKIE}=${signAdminSession()}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function draft() { return { revision: configRevision(cloud), settings: { ...initialSettings, name: '新影院' } }; }
function expectNoCloudAccess() {
  for (const fn of [assertProject, deployments, readCloudEnv, triggerDeployment, writeCloudEnv]) expect(fn).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ADMIN_PASSWORD_HASH', `${'a'.repeat(32)}:${'b'.repeat(64)}`);
  vi.stubEnv('ADMIN_SESSION_SECRET', 'test-only-secret');
  vi.stubEnv('ADMIN_ORIGIN', 'https://site.example');
  vi.stubEnv('ADMIN_CONFIG_REVISION', 'deployed-old');
  cloud = { NEXT_PUBLIC_SITE_NAME: '旧影院', ADMIN_CONFIG_REVISION: 'deployed-old', ...Object.fromEntries(privateKeys.map(key => [key, `private-${key}`])) };
  vi.mocked(readCloudEnv).mockImplementation(async () => ({ entries: Object.entries(cloud).map(([Key, Value]) => ({ Key, Value })), values: { ...cloud } }));
  vi.mocked(deployments).mockResolvedValue([]);
  vi.mocked(triggerDeployment).mockResolvedValue('deployment-new');
  vi.mocked(writeCloudEnv).mockImplementation(async (values) => { cloud = { ...cloud, ...values }; });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('administrator configuration API', () => {
  it('rejects unauthenticated reads and writes without contacting the cloud', async () => {
    expect((await GET(request(undefined, false))).status).toBe(401);
    expect((await POST(request(draft(), false))).status).toBe(401);
    expectNoCloudAccess();
  });
  it('rejects a cross-origin authenticated write without contacting the cloud', async () => {
    expect((await POST(request(draft(), true, 'https://evil.example'))).status).toBe(403);
    expectNoCloudAccess();
  });
  it('returns only the settings snapshot and revision metadata when reading', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ settings: { name: '旧影院' }, revision: configRevision(cloud), configuredRevision: 'deployed-old', deployedRevision: 'deployed-old' });
    for (const key of privateKeys) expect(JSON.stringify(body)).not.toContain(key);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects stale revisions without writing or deploying', async () => {
    expect((await POST(request({ ...draft(), revision: 'stale' }))).status).toBe(409);
    expect(writeCloudEnv).not.toHaveBeenCalled();
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it('rejects saves while a production deployment is active', async () => {
    vi.mocked(deployments).mockResolvedValue([{ id: 'active', status: 'Building', date: '', commit: '', message: '', branch: 'main' }]);
    expect((await POST(request(draft()))).status).toBe(409);
    expect(writeCloudEnv).not.toHaveBeenCalled();
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it('rejects invalid settings before any cloud write', async () => {
    const body = draft();
    expect((await POST(request({ ...body, settings: { ...body.settings, live: 'false' } }))).status).toBe(400);
    expect(writeCloudEnv).not.toHaveBeenCalled();
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it('writes only managed values, preserves private cloud values, verifies the readback, then deploys', async () => {
    const body = draft();
    const response = await POST(request({ ...body, settings: { ...body.settings, ...Object.fromEntries(privateKeys.map(key => [key, 'injected'])) } }));
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot).toMatchObject({ settings: { name: '新影院' }, revision: configRevision(cloud), configuredRevision: cloud.ADMIN_CONFIG_REVISION, deployedRevision: 'deployed-old', deploymentId: 'deployment-new' });
    expect(cloud.ADMIN_CONFIG_REVISION).not.toBe('deployed-old');
    const updates = vi.mocked(writeCloudEnv).mock.calls[0][0];
    expect(Object.keys(updates).every(key => managedKeys.includes(key))).toBe(true);
    for (const key of privateKeys) {
      expect(updates).not.toHaveProperty(key);
      expect(cloud[key]).toBe(`private-${key}`);
      expect(JSON.stringify(snapshot)).not.toContain(key);
    }
    expect(readCloudEnv).toHaveBeenCalledTimes(2);
    expect(triggerDeployment).toHaveBeenCalledTimes(1);
    expect(vi.mocked(triggerDeployment).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(readCloudEnv).mock.invocationCallOrder[1]);
  });
  it('does not deploy when the cloud readback differs from the submitted update', async () => {
    vi.mocked(writeCloudEnv).mockImplementation(async (updates) => { cloud = { ...cloud, ...updates, NEXT_PUBLIC_SITE_NAME: 'concurrent-change' }; });
    expect((await POST(request(draft()))).status).toBe(409);
    expect(writeCloudEnv).toHaveBeenCalledTimes(1);
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
  it('returns the saved snapshot and deploymentError if deployment submission fails', async () => {
    vi.mocked(triggerDeployment).mockRejectedValue(new Error('deployment unavailable'));
    const response = await POST(request(draft()));
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot).toMatchObject({ settings: { name: '新影院' }, revision: configRevision(cloud), configuredRevision: cloud.ADMIN_CONFIG_REVISION });
    expect(snapshot.deploymentError).toContain('配置已保存');
    expect(snapshot.deploymentError).toContain('deployment unavailable');
    expect(snapshot).not.toHaveProperty('deploymentId');
  });
  it('stops before writing if the configured project identity is wrong', async () => {
    vi.mocked(assertProject).mockRejectedValue(new Error('wrong project'));
    expect((await POST(request(draft()))).status).toBe(502);
    expect(readCloudEnv).not.toHaveBeenCalled();
    expect(writeCloudEnv).not.toHaveBeenCalled();
    expect(triggerDeployment).not.toHaveBeenCalled();
  });
});
