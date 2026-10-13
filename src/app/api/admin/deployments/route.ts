import { adminGuard, adminJson } from '@/lib/admin-auth';
import { assertProject, deploymentBusy, deployments, readCloudEnv, triggerDeployment, withAdminMutation } from '@/lib/edgeone-admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  try { return adminJson({ records: await deployments(), deployedRevision: process.env.ADMIN_CONFIG_REVISION || '' }); }
  catch (e) { return adminJson({ error: e instanceof Error ? e.message : '读取发布记录失败。' }, 502); }
}
export async function POST(req: Request) {
  const denied = adminGuard(req, true); if (denied) return denied;
  try {
    return await withAdminMutation(async () => {
      await assertProject();
      const records = await deployments();
      const active = records.find(d => deploymentBusy(d.status));
      if (active) return adminJson({ deploymentId: active.id });
      const { values } = await readCloudEnv();
      if (!values.ADMIN_CONFIG_REVISION || values.ADMIN_CONFIG_REVISION === (process.env.ADMIN_CONFIG_REVISION || '')) return adminJson({ error: '当前配置已经生效，无需重新部署。' }, 409);
      return adminJson({ deploymentId: await triggerDeployment() });
    });
  } catch (e) { return adminJson({ error: e instanceof Error ? e.message : '提交部署失败。' }, 502); }
}
