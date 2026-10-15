export interface HeroSlot {
  id: string; name: string; start: number; title: string; caption: string;
  image: string; mobileImage: string; position: string; mobilePosition: string; shade: number;
}
export interface HeroConfig { mode: 'auto' | 'fixed'; fixed: string; slots: HeroSlot[] }
const ids = ['dawn', 'day', 'afternoon', 'sunset', 'evening', 'midnight'] as const;
export const heroEnvKeys = ['NEXT_PUBLIC_HERO_MODE', 'NEXT_PUBLIC_HERO_FIXED', ...ids.map(id => `NEXT_PUBLIC_HERO_${id.toUpperCase()}`)];
export const defaultHeroConfig: HeroConfig = {
  mode: 'auto', fixed: 'evening',
  slots: [
    ['dawn', '晨光', 300, '天刚亮，\n故事正要开始。', '给今天，留一点想象。'],
    ['day', '日间', 540, '日光正好，\n遇见另一种人生。', '从一段光影，发现新的世界。'],
    ['afternoon', '午后', 720, '给午后，\n留一段好故事。', '放慢一点，让想象走远。'],
    ['sunset', '黄昏', 1020, '当日落下，\n让故事亮起来。', '白昼将尽，光影正好。'],
    ['evening', '夜晚', 1140, '把今晚，\n交给好故事。', '有些故事，仍在等你。'],
    ['midnight', '深夜', 1380, '夜深了，\n故事还醒着。', '世界安静下来，故事慢慢展开。'],
  ].map(([id, name, start, title, caption]) => ({ id: String(id), name: String(name), start: Number(start), title: String(title), caption: String(caption), image: `/images/hero/${id}.webp`, mobileImage: `/images/hero/${id}.webp`, position: '50% 50%', mobilePosition: '100% 50%', shade: 0 })),
};
function imagePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500 || /[\s\x00-\x1f\x7f\\]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://hero.invalid');
    if (value.startsWith('/images/')) return url.origin === 'https://hero.invalid' && url.pathname.startsWith('/images/');
    return value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
function text(value: unknown, max: number, lines = 1): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.split('\n').length <= lines && !/[\x00-\x09\x0b-\x1f\x7f]/.test(value);
}
function position(value: unknown): value is string {
  return typeof value === 'string' && /^(?:100|\d{1,2})(?:\.\d{1,2})?% (?:100|\d{1,2})(?:\.\d{1,2})?%$/.test(value) && value.split(' ').every(n => parseFloat(n) <= 100);
}
export function parseHeroConfig(value: unknown): HeroConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('首页光影配置格式无效。');
  const input = value as Record<string, unknown>;
  if (!['auto', 'fixed'].includes(input.mode as string) || !ids.includes(input.fixed as typeof ids[number]) || !Array.isArray(input.slots) || input.slots.length !== 6) throw new Error('首页光影需要完整的六个时段和有效运行方式。');
  const seen = new Set<string>();
  const starts = new Set<number>();
  const slots = input.slots.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('首页光影时段格式无效。');
    const s = value as HeroSlot;
    if (!ids.includes(s.id as typeof ids[number]) || seen.has(s.id) || !Number.isInteger(s.start) || s.start < 0 || s.start > 1439 || starts.has(s.start)) throw new Error('首页光影时段标识或开始时间重复、无效。');
    if (!text(s.name, 16) || !text(s.title, 60, 2) || !text(s.caption, 80) || !imagePath(s.image) || !imagePath(s.mobileImage) || !position(s.position) || !position(s.mobilePosition) || !Number.isFinite(s.shade) || s.shade < 0 || s.shade > 80) throw new Error('首页光影文案、图片、焦点或遮罩无效。图片须为 /images/ 路径或不含账号密码的 HTTPS 地址。');
    seen.add(s.id); starts.add(s.start);
    return { id: s.id, name: s.name.trim(), start: s.start, title: s.title.trim(), caption: s.caption.trim(), image: s.image, mobileImage: s.mobileImage, position: s.position, mobilePosition: s.mobilePosition, shade: s.shade };
  }).sort((a, b) => a.start - b.start);
  return { mode: input.mode as HeroConfig['mode'], fixed: input.fixed as string, slots };
}
export function heroAt(config: HeroConfig, date: Date | number = Date.now()): HeroSlot {
  if (config.mode === 'fixed') return config.slots.find(s => s.id === config.fixed)!;
  const beijing = new Date(Number(date) + 8 * 60 * 60 * 1000);
  const minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const slots = [...config.slots].sort((a, b) => a.start - b.start);
  return slots.filter(s => s.start <= minute).at(-1) || slots[slots.length - 1];
}
export function heroFromEnv(env: Record<string, string | undefined>): HeroConfig {
  try {
    return parseHeroConfig({ mode: env.NEXT_PUBLIC_HERO_MODE ?? defaultHeroConfig.mode, fixed: env.NEXT_PUBLIC_HERO_FIXED ?? defaultHeroConfig.fixed, slots: defaultHeroConfig.slots.map(s => env[`NEXT_PUBLIC_HERO_${s.id.toUpperCase()}`] ? JSON.parse(env[`NEXT_PUBLIC_HERO_${s.id.toUpperCase()}`]!) : s) });
  } catch { return structuredClone(defaultHeroConfig); }
}
export function heroToEnv(value: unknown): Record<string, string> {
  const config = parseHeroConfig(value);
  const env: Record<string, string> = { NEXT_PUBLIC_HERO_MODE: config.mode, NEXT_PUBLIC_HERO_FIXED: config.fixed };
  for (const slot of config.slots) {
    const serialized = JSON.stringify(slot);
    if (new TextEncoder().encode(serialized).length > 1000) throw new Error(`首页光影“${slot.name}”超过 EdgeOne 单个环境变量 1000 字节限制，请缩短文案或图片地址。`);
    env[`NEXT_PUBLIC_HERO_${slot.id.toUpperCase()}`] = serialized;
  }
  return env;
}
