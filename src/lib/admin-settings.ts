import { defaultHeroConfig, heroToEnv, parseHeroConfig, type HeroConfig } from './home-hero';

export type Section = 'site' | 'hero' | 'features' | 'sources' | 'playback' | 'newsletter' | 'history' | 'analytics';
export type SourceKind = 'vod' | 'live' | 'subscription';
export interface AdminSource { id: string; kind: SourceKind; name: string; url: string; enabled: boolean }
export interface Settings {
  hero: HeroConfig;
  name: string; subtitle: string; description: string; announcement: string; logo: 'a' | 'b' | 'c';
  live: boolean; settings: boolean; recommendations: boolean;
  recommendSource: string; imageMode: string; autoplay: boolean; adFilter: boolean; adultFilter: boolean;
  sources: AdminSource[];
  newsletterEnabled: boolean; newsletterStyle: 'lighthouse' | 'ticket' | 'minimal';
}
export const initialSettings: Settings = {
  hero: defaultHeroConfig,
  name: '04320TV', subtitle: '光影之间', description: '搜索电影、剧集，找到下一段光影。',
  announcement: '有些故事，仍在等你。', logo: 'a', live: true, settings: true, recommendations: true,
  recommendSource: 'hot-list', imageMode: 'direct', autoplay: true, adFilter: true, adultFilter: true,
  sources: [],
  newsletterEnabled: false, newsletterStyle: 'lighthouse',
};
export const labels: Record<keyof Settings, string> = {
  hero: '首页光影',
  name: '网站名称', subtitle: '网站副标题', description: '网站描述', announcement: '网站公告', logo: 'Logo 样式',
  live: '直播功能', settings: '前台设置入口', recommendations: '首页推荐', recommendSource: '默认推荐来源',
  imageMode: '封面加载方式', autoplay: '自动播放下一集', adFilter: '广告过滤', adultFilter: '成人内容过滤', sources: '数据源',
  newsletterEnabled: '邮件订阅入口', newsletterStyle: '邮件订阅弹窗样式',
};
export function changes(before: Settings, after: Settings) {
  return (Object.keys(labels) as (keyof Settings)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
export function describeValue(value: Settings[keyof Settings]): string {
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (Array.isArray(value)) return value.map((source) => `${source.name} · ${source.enabled ? '开启' : '关闭'} · ${source.url}`).join('\n') || '无数据源';
  if (value && typeof value === 'object') {
    const scenes = [...value.slots, ...value.weather];
    const mode = value.mode === 'auto' ? '北京时间自动切换' : value.mode === 'weather' ? '北京时间与当地天气自动切换' : `固定：${scenes.find(s => s.id === value.fixed)?.name || value.fixed}`;
    return `${mode}\n${scenes.map(s => `${s.name} · ${value.weather.includes(s) ? (s.id.endsWith('day') ? '天气 · 白昼' : '天气 · 入夜') : `${String(Math.floor(s.start / 60)).padStart(2, '0')}:${String(s.start % 60).padStart(2, '0')}`} · ${s.title.replace('\n', ' ')} · ${s.caption}\n桌面：${s.image}（${s.position}）\n手机：${s.mobileImage}（${s.mobilePosition}）· 遮罩 ${s.shade}%`).join('\n')}`;
  }
  if (value === 'lighthouse' || value === 'ticket' || value === 'minimal') return { lighthouse: '灯塔来信', ticket: '电影票根', minimal: '极简片尾' }[value];
  return ({ 'hot-list': '影视热榜', douban: '豆瓣热门', bangumi: '新番放送', direct: '直连优先', proxy: '内置代理优先', a: 'A · 影院经典', b: 'B · 醒目标识', c: 'C · 灯塔光影' } as Record<string, string>)[value] || value || '未设置';
}
export function validateSettings(s: Settings): { section: Section; message: string } | null {
  try { heroToEnv(s.hero); } catch (error) { return { section: 'hero', message: error instanceof Error ? error.message : '首页光影配置无效。' }; }
  if (!s.name.trim()) return { section: 'site', message: '请填写网站名称。' };
  for (const [key, max] of [['name', 50], ['subtitle', 50], ['description', 200], ['announcement', 200]] as const) {
    if (s[key].length > max) return { section: 'site', message: `${labels[key]}最多 ${max} 个字符。` };
    if (new TextEncoder().encode(s[key]).length > 1000) return { section: 'site', message: `${labels[key]}超过环境变量的 1000 字节限制。` };
  }
  for (const source of s.sources) {
    if (!source.name.trim()) return { section: 'sources', message: '请为每个数据源填写名称。' };
    try {
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { return { section: 'sources', message: `“${source.name}”需要不含账号密码的完整 HTTP(S) 地址。` }; }
  }
  return null;
}

export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置格式无效。');
  const input = value as Record<string, unknown>;
  if (typeof input.newsletterEnabled !== 'boolean' || !['lighthouse', 'ticket', 'minimal'].includes(input.newsletterStyle as string)) throw new Error('邮件订阅配置无效。');
  for (const key of ['name', 'subtitle', 'description', 'announcement', 'logo', 'recommendSource', 'imageMode']) {
    if (typeof input[key] !== 'string') throw new Error('配置字段类型无效。');
  }
  for (const key of ['live', 'settings', 'recommendations', 'autoplay', 'adFilter', 'adultFilter']) {
    if (typeof input[key] !== 'boolean') throw new Error('配置开关类型无效。');
  }
  if (!['a', 'b', 'c'].includes(input.logo as string) || !['hot-list', 'douban', 'bangumi'].includes(input.recommendSource as string) || !['direct', 'proxy'].includes(input.imageMode as string)) throw new Error('配置选项无效。');
  if (!Array.isArray(input.sources) || input.sources.length > 50) throw new Error('数据源最多支持 50 项。');
  const ids = new Set<string>();
  const sources = input.sources.map((source) => {
    if (!source || typeof source !== 'object' || !['vod', 'live', 'subscription'].includes(source.kind) || typeof source.name !== 'string' || source.name.length > 80 || typeof source.url !== 'string' || source.url.length > 1000 || typeof source.enabled !== 'boolean' || typeof source.id !== 'string' || !/^[\w-]{1,64}$/.test(source.id) || ids.has(source.id)) throw new Error('数据源格式或标识无效。');
    ids.add(source.id);
    return { id: source.id, kind: source.kind, name: source.name.trim(), url: source.url.trim(), enabled: source.enabled } as AdminSource;
  });
  const settings = Object.fromEntries(Object.keys(labels).map(key => [key, key === 'sources' ? sources : key === 'hero' ? parseHeroConfig(input.hero === undefined ? defaultHeroConfig : input.hero) : input[key]])) as unknown as Settings;
  const error = validateSettings(settings);
  if (error) throw new Error(error.message);
  settings.name = settings.name.trim();
  return settings;
}
