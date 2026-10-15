import crypto from 'node:crypto';
import { initialSettings, parseSettings, type Settings, type SourceKind } from './admin-settings';
import { heroEnvKeys, heroFromEnv, heroToEnv } from './home-hero';

export const settingKeys = {
  newsletterEnabled: 'NEXT_PUBLIC_NEWSLETTER_ENABLED', newsletterStyle: 'NEXT_PUBLIC_NEWSLETTER_STYLE',
  name: 'NEXT_PUBLIC_SITE_NAME', subtitle: 'NEXT_PUBLIC_SITE_SUBTITLE', description: 'NEXT_PUBLIC_SITE_DESCRIPTION', announcement: 'NEXT_PUBLIC_SITE_ANNOUNCEMENT', logo: 'NEXT_PUBLIC_LOGO_STYLE',
  live: 'LIVE_ENABLED', settings: 'SETTINGS_ENABLED', recommendations: 'NEXT_PUBLIC_RECOMMENDATIONS_ENABLED',
  recommendSource: 'DEFAULT_RECOMMEND_SOURCE', imageMode: 'DEFAULT_IMAGE_MODE', autoplay: 'NEXT_PUBLIC_DEFAULT_AUTOPLAY', adFilter: 'NEXT_PUBLIC_DEFAULT_AD_FILTER', adultFilter: 'NEXT_PUBLIC_DEFAULT_ADULT_FILTER',
} as const;
export const sourceKeys = { vod: 'DEFAULT_SOURCES', live: 'DEFAULT_LIVE_SOURCES', subscription: 'DEFAULT_SUBSCRIPTIONS' } as const;
export const managedKeys = [...Object.values(settingKeys), ...Object.values(sourceKeys), ...heroEnvKeys, 'ADMIN_CONFIG_REVISION', 'PASSWORD'];
export type Env = Record<string, string>;
export function accessPasswordUpdate(value: unknown): Env {
  if (value === undefined) return {};
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1000 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('网站访问密码须为不超过 1000 字节且不含控制字符的文本。');
  return { PASSWORD: value };
}
function rawSources(env: Env, kind: SourceKind): Record<string, unknown>[] {
  const value = env[sourceKeys[kind]];
  if (!value) return [];
  const items = JSON.parse(value);
  if (!Array.isArray(items)) throw new Error('线上数据源格式异常，请先在 EdgeOne 检查配置。');
  return items.map(item => typeof item === 'string' ? { url: item } : item);
}
export function settingsFromEnv(env: Env): Settings {
  const settings = structuredClone(initialSettings);
  settings.hero = heroFromEnv(env);
  for (const [key, envKey] of Object.entries(settingKeys)) {
    if (env[envKey] !== undefined) Object.assign(settings, { [key]: typeof initialSettings[key as keyof Settings] === 'boolean' ? env[envKey] !== 'false' : env[envKey] });
  }
  settings.logo = settings.logo.toLowerCase() as Settings['logo'];
  settings.sources = (Object.keys(sourceKeys) as SourceKind[]).flatMap(kind => rawSources(env, kind).map((item, index) => ({ id: `${kind}-${index}`, kind, name: String(item.name || item.url || ''), url: String(item.url || ''), enabled: item.enabled !== false })));
  return settings;
}
export function configRevision(env: Env) {
  return crypto.createHash('sha256').update(JSON.stringify(managedKeys.map(key => [key, env[key] ?? null]))).digest('hex');
}
export function settingsToEnv(value: unknown, previous: Env): Env {
  const settings = parseSettings(value);
  const values: Env = heroToEnv(settings.hero);
  for (const [key, envKey] of Object.entries(settingKeys)) values[envKey] = String(settings[key as keyof typeof settingKeys]);
  for (const kind of Object.keys(sourceKeys) as SourceKind[]) {
    const originals = rawSources(previous, kind);
    values[sourceKeys[kind]] = JSON.stringify(settings.sources.filter(s => s.kind === kind).map(source => {
      const index = /^\w+-\d+$/.test(source.id) && source.id.startsWith(`${kind}-`) ? Number(source.id.slice(kind.length + 1)) : -1;
      const original = originals[index] || {};
      // 保留未在当前表单编辑的 detail/isAdult/epg 等原有源字段。
      return { ...original, name: source.name, url: source.url, enabled: source.enabled };
    }));
  }
  for (const [key, value] of Object.entries(values)) if (Buffer.byteLength(value, 'utf8') > 1000) throw new Error(`${key} 超过 EdgeOne 单个环境变量 1000 字节限制，请减少条目或改用订阅链接。`);
  return values;
}
