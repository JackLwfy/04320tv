export type Section = 'site' | 'features' | 'sources' | 'playback' | 'history';
export type SourceKind = 'vod' | 'live' | 'subscription';
export interface AdminSource { id: string; kind: SourceKind; name: string; url: string; enabled: boolean }
export interface Settings {
  name: string; subtitle: string; description: string; announcement: string; logo: 'a' | 'b' | 'c';
  live: boolean; settings: boolean; recommendations: boolean;
  recommendSource: string; imageMode: string; autoplay: boolean; adFilter: boolean; adultFilter: boolean;
  sources: AdminSource[];
}
export const initialSettings: Settings = {
  name: '04320TV', subtitle: '光影之间', description: '搜索电影、剧集，找到下一段光影。',
  announcement: '有些故事，仍在等你。', logo: 'a', live: true, settings: true, recommendations: true,
  recommendSource: 'hot-list', imageMode: 'direct', autoplay: true, adFilter: true, adultFilter: true,
  sources: [
    { id: 'demo-vod', kind: 'vod', name: '电影资料库 · 示例', url: 'https://example.com/api/vod', enabled: true },
    { id: 'demo-live', kind: 'live', name: '直播频道 · 示例', url: 'https://example.com/live.m3u', enabled: true },
  ],
};
export const labels: Record<keyof Settings, string> = {
  name: '网站名称', subtitle: '网站副标题', description: '网站描述', announcement: '网站公告', logo: 'Logo 样式',
  live: '直播功能', settings: '前台设置入口', recommendations: '首页推荐', recommendSource: '默认推荐来源',
  imageMode: '封面加载方式', autoplay: '自动播放下一集', adFilter: '广告过滤', adultFilter: '成人内容过滤', sources: '数据源',
};
export function changes(before: Settings, after: Settings) {
  return (Object.keys(labels) as (keyof Settings)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
export function describeValue(value: Settings[keyof Settings]): string {
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (Array.isArray(value)) return value.map((source) => `${source.name} · ${source.enabled ? '开启' : '关闭'} · ${source.url}`).join('\n') || '无数据源';
  return ({ 'hot-list': '影视热榜', douban: '豆瓣热门', bangumi: '新番放送', direct: '直连优先', proxy: '内置代理优先', a: 'A · 影院经典', b: 'B · 醒目标识', c: 'C · 灯塔光影' } as Record<string, string>)[value] || value || '未设置';
}
export function validateSettings(s: Settings): { section: Section; message: string } | null {
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
