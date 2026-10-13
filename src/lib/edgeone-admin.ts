import { type Env } from './admin-config';

export type CloudEnv = { Id?: string | number; Key: string; Value: string; Comment?: string };
export type Deployment = { DeploymentId: string; Status: string; Env: string; CreatedOn: string; RepoCommitHash?: string; RepoCommitMsg?: string; RepoBranch?: string };
type Project = { ProjectId: string; Name: string; Provider: string; RepoUrl: string; RepoBranch: string };
export function projectId() {
  const id = process.env.EDGEONE_PROJECT_ID;
  if (!id || !process.env.EDGEONE_API_TOKEN) throw new Error('EdgeOne 管理连接未配置。');
  return id;
}
export async function edgeone<T>(action: string, body: Record<string, unknown>): Promise<T> {
  projectId();
  let response: Response;
  try {
    response = await fetch('https://pages-api.edgeone.ai/v1', { method: 'POST', headers: { Authorization: `Bearer ${process.env.EDGEONE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ Action: action, ...body }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('EdgeOne 请求未确认，请刷新发布记录后重试，避免重复提交。'); }
  const data = await response.json();
  const result = data?.Data?.Response;
  if (!response.ok || String(data.Code) !== '0' || !result || result.Error) throw new Error(`EdgeOne 操作失败（${result?.Error?.Code || data.Code || response.status}），请稍后重试。`);
  return result as T;
}
export async function assertProject() {
  const result = await edgeone<{ Projects: Project[] }>('DescribePagesProjects', { ProjectIds: [projectId()] });
  const p = result.Projects?.[0];
  if (p?.ProjectId !== projectId() || p.Provider !== 'Github' || p.RepoUrl !== 'https://github.com/JackLwfy/04320tv' || p.RepoBranch !== 'main') throw new Error('EdgeOne 项目绑定与预期仓库不符，已阻止修改。');
}
export async function readCloudEnv() {
  const result = await edgeone<{ EnvVars: CloudEnv[] }>('DescribePagesProjectEnvs', { ProjectId: projectId() });
  if (!Array.isArray(result.EnvVars)) throw new Error('EdgeOne 配置响应无效。');
  return { entries: result.EnvVars, values: Object.fromEntries(result.EnvVars.map(v => [v.Key, v.Value])) as Env };
}
export async function writeCloudEnv(values: Env, entries: CloudEnv[]) {
  const updates = Object.entries(values).filter(([key, value]) => key !== 'PASSWORD' || value !== '');
  if (updates.length) await edgeone('ModifyPagesProjectEnvs', { ProjectId: projectId(), EnvVars: updates.map(([Key, Value]) => ({ ...entries.find(e => e.Key === Key), Key, Value })) });
  // EdgeOne 不接受空值，移除变量才表示公开访问。
  const password = entries.find(e => e.Key === 'PASSWORD');
  if (values.PASSWORD === '' && password) await edgeone('DeletePagesProjectEnvs', { ProjectId: projectId(), EnvVars: [password] });
}
export async function deployments() {
  const result = await edgeone<{ Deployments: Deployment[] }>('DescribePagesDeployments', { ProjectId: projectId(), Offset: 0, Limit: 10, OrderBy: 'CreatedOn', OrderType: 'Desc' });
  if (!Array.isArray(result.Deployments)) throw new Error('EdgeOne 发布记录响应无效。');
  return result.Deployments.filter(d => d.Env === 'Production').map(d => ({ id: d.DeploymentId, status: d.Status, date: d.CreatedOn, commit: d.RepoCommitHash?.slice(0, 7) || '', message: d.RepoCommitMsg || '', branch: d.RepoBranch || 'main' }));
}
export const deploymentBusy = (status: string) => !['Success', 'Failed', 'Timeout', 'Cancelled', 'Invalid', 'Expired'].includes(status);
export async function triggerDeployment() {
  const result = await edgeone<{ DeploymentId: string }>('CreatePagesDeployment', { ProjectId: projectId(), ViaMeta: 'Github', Provider: 'Github', Env: 'Production', RepoBranch: 'main' });
  if (!result.DeploymentId) throw new Error('部署结果未确认，请刷新发布记录。');
  return result.DeploymentId;
}

// shortcut: 同实例互斥加云端版本校验用于单管理员；多实例同时提交仍需共享事务锁。
let mutating = false;
export async function withAdminMutation<T>(run: () => Promise<T>) {
  if (mutating) throw new Error('另一个保存请求正在处理，请稍后刷新。');
  mutating = true;
  try { return await run(); } finally { mutating = false; }
}
