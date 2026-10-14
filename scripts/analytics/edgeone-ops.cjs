// Operator helper. Secrets and API responses stay in a private directory outside the checkout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const privateDir = path.resolve(root, '../.04320-analytics-private');
const projectId = 'makers-dsjbl7qamnig';
const tokenText = fs.readFileSync(path.join(root, '腾讯云apikey.txt'), 'utf8');
const token = tokenText.match(/apitoken\s*[:：=]\s*(\S+)/i)?.[1];
if (!token) throw new Error('API token not found in operator file');
async function api(Action, args = {}) {
  const r = await fetch('https://pages-api.edgeone.ai/v1', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ Action, ...args }), signal: AbortSignal.timeout(30000) });
  const body = await r.json(); const data = body?.Data?.Response;
  if (!r.ok || String(body.Code) !== '0' || !data || data.Error) throw new Error(`EdgeOne ${Action} failed: ${data?.Error?.Code || body.Code || r.status}`);
  return data;
}
async function env() {
  const { EnvVars } = await api('DescribePagesProjectEnvs', { ProjectId: projectId });
  return { entries: EnvVars, values: Object.fromEntries(EnvVars.map(e => [e.Key, e.Value])) };
}
async function main() {
  const { Projects } = await api('DescribePagesProjects', { ProjectIds: [projectId] });
  if (Projects[0]?.RepoUrl !== 'https://github.com/JackLwfy/04320tv' || Projects[0]?.RepoBranch !== 'main') throw new Error('Project identity mismatch');
  const mode = process.argv[2];
  if (mode === 'configure') {
    const previous = await env();
    const backup = path.join(privateDir, 'edgeone-env-before.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(previous.entries));
    const db = JSON.parse(fs.readFileSync(path.join(privateDir, 'connection.json'), 'utf8'));
    const values = { ANALYTICS_DB_HOST: db.host, ANALYTICS_DB_TLS_NAME: 'mail.fafamail.com', ANALYTICS_DB_PORT: String(db.port), ANALYTICS_DB_NAME: db.database, ANALYTICS_DB_USER: db.user, ANALYTICS_DB_PASSWORD: db.password, ANALYTICS_DB_CA: db.ca.trim().replace(/\n/g, '\\n'), ANALYTICS_INGEST_SECRET: db.ingestSecret, ANALYTICS_ENABLED: 'false' };
    if (Object.values(values).some(v => Buffer.byteLength(v) > 1000)) throw new Error('Environment value too large');
    await api('ModifyPagesProjectEnvs', { ProjectId: projectId, EnvVars: Object.entries(values).map(([Key, Value]) => ({ ...previous.entries.find(e => e.Key === Key), Key, Value })) });
    const check = await env();
    if (Object.entries(values).some(([k, v]) => check.values[k] !== v)) throw new Error('Environment verification failed');
    console.log('ANALYTICS_ENV_CONFIGURED', Object.keys(values));
  } else if (mode === 'deploy') {
    const result = await api('CreatePagesDeployment', { ProjectId: projectId, ViaMeta: 'Github', Provider: 'Github', Env: 'Production', RepoBranch: 'main' });
    fs.writeFileSync(path.join(privateDir, 'deployment.json'), JSON.stringify(result));
    console.log('DEPLOYMENT', result.DeploymentId);
  } else if (mode === 'status') {
    const { Deployments } = await api('DescribePagesDeployments', { ProjectId: projectId, Offset: 0, Limit: 5, OrderBy: 'CreatedOn', OrderType: 'Desc' });
    console.log(JSON.stringify(Deployments.map(d => ({ id: d.DeploymentId, status: d.Status, commit: d.RepoCommitHash, env: d.Env }))));
  } else if (mode === 'health') {
    const { values } = await env();
    const value = `${Date.now() + 60000}.${crypto.randomBytes(16).toString('hex')}`;
    const signature = crypto.createHmac('sha256', `${values.ADMIN_SESSION_SECRET}:${values.ADMIN_PASSWORD_HASH}`).update(value).digest('hex');
    const r = await fetch('https://04320.com/api/admin/analytics/health', { headers: { Cookie: `tv_admin_session=${value}.${signature}` }, signal: AbortSignal.timeout(15000) });
    console.log('LIVE_DATABASE_HEALTH', r.status, await r.text());
    if (!r.ok) process.exitCode = 1;
  } else if (mode === 'enable' || mode === 'disable') {
    const previous = await env();
    const Value = mode === 'enable' ? 'true' : 'false';
    await api('ModifyPagesProjectEnvs', { ProjectId: projectId, EnvVars: [{ ...previous.entries.find(e => e.Key === 'ANALYTICS_ENABLED'), Key: 'ANALYTICS_ENABLED', Value }] });
    if ((await env()).values.ANALYTICS_ENABLED !== Value) throw new Error('Activation verification failed');
    console.log('ANALYTICS_ENABLED', Value, 'Redeploy required');
  } else { throw new Error('Expected configure, deploy, status, health, enable or disable'); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
