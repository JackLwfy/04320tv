import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeCloudEnv } from './edgeone-admin';

const calls: Record<string, unknown>[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubEnv('EDGEONE_PROJECT_ID', 'test-project');
  vi.stubEnv('EDGEONE_API_TOKEN', 'test-only-token');
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ Code: 0, Data: { Response: {} } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('removes a blank access password using the existing platform entry, without sending an empty value', async () => {
  const password = { Id: 'env-id', Key: 'PASSWORD', Value: 'test-password' };
  await writeCloudEnv({ PASSWORD: '', ADMIN_CONFIG_REVISION: 'next' }, [password]);
  expect(calls).toEqual([
    { Action: 'ModifyPagesProjectEnvs', ProjectId: 'test-project', EnvVars: [{ Key: 'ADMIN_CONFIG_REVISION', Value: 'next' }] },
    { Action: 'DeletePagesProjectEnvs', ProjectId: 'test-project', EnvVars: [password] },
  ]);
});
it('preserves an omitted password and does not delete an already missing one', async () => {
  await writeCloudEnv({ NEXT_PUBLIC_SITE_NAME: 'Test' }, [{ Key: 'PASSWORD', Value: 'keep' }]);
  expect(calls).toHaveLength(1);
  expect(calls[0].Action).toBe('ModifyPagesProjectEnvs');
  calls.length = 0;
  await writeCloudEnv({ PASSWORD: '' }, []);
  expect(calls).toHaveLength(0);
});
