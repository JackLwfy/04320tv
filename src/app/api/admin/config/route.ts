import crypto from 'node:crypto';
import { adminGuard, adminJson, readAdminBody } from '@/lib/admin-auth';
import { accessPasswordUpdate, configRevision, settingsFromEnv, settingsToEnv } from '@/lib/admin-config';
import { assertProject, deploymentBusy, deployments, readCloudEnv, triggerDeployment, withAdminMutation, writeCloudEnv } from '@/lib/edgeone-admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const denied = adminGuard(req); if (denied) return denied;
  try {
    const { values } = await readCloudEnv();
    return adminJson({ settings: settingsFromEnv(values), accessPasswordConfigured: !!values.PASSWORD, revision: configRevision(values), configuredRevision: values.ADMIN_CONFIG_REVISION || '', deployedRevision: process.env.ADMIN_CONFIG_REVISION || '' });
  } catch (e) { return adminJson({ error: e instanceof Error ? e.message : '读取配置失败。' }, 502); }
}
export async function POST(req: Request) {
  const denied = adminGuard(req, true); if (denied) return denied;
  let body;
  try { body = await readAdminBody(req); } catch { return adminJson({ error: '请求格式无效或内容过大。' }, 400); }
  try {
    return await withAdminMutation(async () => {
      await assertProject();
      const { entries, values } = await readCloudEnv();
      if (body?.revision !== configRevision(values)) return adminJson({ error: '配置已被其他页面或控制台修改。请重新读取配置后再保存。' }, 409);
      let updates;
      try { updates = { ...settingsToEnv(body?.settings, values), ...accessPasswordUpdate(body?.accessPassword) }; } catch (e) { return adminJson({ error: e instanceof Error ? e.message : '配置格式无效。' }, 400); }
      const records = await deployments();
      if (records.some(d => deploymentBusy(d.status))) return adminJson({ error: '已有生产部署正在进行，请等待完成后保存。' }, 409);
      updates.ADMIN_CONFIG_REVISION = crypto.randomUUID();
      await writeCloudEnv(updates, entries);
      const current = await readCloudEnv();
      if (Object.entries(updates).some(([key, value]) => (key === 'PASSWORD' ? current.values[key] || '' : current.values[key]) !== value)) return adminJson({ error: '云端保存结果与本次提交不一致，请重新读取配置。' }, 409);
      const snapshot = { settings: settingsFromEnv(current.values), accessPasswordConfigured: !!current.values.PASSWORD, revision: configRevision(current.values), configuredRevision: updates.ADMIN_CONFIG_REVISION, deployedRevision: process.env.ADMIN_CONFIG_REVISION || '' };
      try { return adminJson({ ...snapshot, deploymentId: await triggerDeployment() }); }
      catch (e) { return adminJson({ ...snapshot, deploymentError: `配置已保存，但部署未确认。${e instanceof Error ? e.message : ''}` }); }
    });
  } catch (e) { return adminJson({ error: e instanceof Error ? e.message : '配置保存失败，请重新读取云端状态。' }, 502); }
}
