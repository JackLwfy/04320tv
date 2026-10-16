'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { defaultHeroConfig, heroForWeather, heroToEnv, type HeroConfig, type HeroSlot } from '@/lib/home-hero';
import s from './hero-editor.module.css';

const fallback = '/images/cinema-coast.webp';
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
function safeImage(value: string) {
  if (/[\s\x00-\x1f\x7f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://hero.invalid');
    if (value.startsWith('/images/') && url.origin === 'https://hero.invalid' && url.pathname.startsWith('/images/')) return value;
    if (value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password) return value;
  } catch { /* 编辑中的不完整地址使用默认图。 */ }
  return fallback;
}
function imageError(event: SyntheticEvent<HTMLImageElement>) {
  if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback;
}
function HeroImage({ src, position, className }: { src: string; position?: string; className?: string }) {
  const safe = safeImage(src);
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={safe} src={safe} alt="" className={className} style={{ objectPosition: position }} onError={imageError} referrerPolicy="no-referrer" />;
}

export function HeroEditor({ value, onChange, disabled = false, description = '搜索电影、剧集，找到下一段光影。', announcement = '' }: { value: HeroConfig; onChange: (value: HeroConfig) => void; disabled?: boolean; description?: string; announcement?: string }) {
  const [selected, setSelected] = useState('evening');
  const [minute, setMinute] = useState(1140);
  const [mobile, setMobile] = useState(false);
  const [weather, setWeather] = useState<'rain' | 'snow' | 'none'>('none');
  const [weatherStatus, setWeatherStatus] = useState('正在读取天气服务状态…');
  const [testingWeather, setTestingWeather] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/weather', { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error();
      setWeatherStatus(result.message || 'Open-Meteo 免费天气，无需账号或密钥。');
    }).catch(() => { if (!controller.signal.aborted) setWeatherStatus('暂时无法读取天气状态，模拟预览仍可使用。'); });
    return () => controller.abort();
  }, []);
  async function testWeather() {
    setTestingWeather(true);
    try {
      const response = await fetch('/api/admin/weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      setWeatherStatus(result.message || (response.ok ? '天气服务连接成功。' : '天气服务暂时不可用，请稍后重试。'));
    } catch { setWeatherStatus('连接测试失败，请稍后重试。'); }
    finally { setTestingWeather(false); }
  }
  const [confirm, setConfirm] = useState<'slot' | 'all' | null>(null);
  const allScenes = [...value.slots, ...value.weather];
  const slot = allScenes.find(item => item.id === selected) || value.slots[0];
  const weatherScene = value.weather.some(item => item.id === slot.id);
  const preview = heroForWeather({ ...value, mode: 'weather' }, Date.UTC(2026, 0, 1, 0, minute - 480), weather);
  const weatherPreview = value.weather.some(item => item.id === preview.id);
  const ordered = [...value.slots].sort((a, b) => a.start - b.start);
  const next = ordered.find(item => item.start > minute) || ordered[0];
  let error = '';
  try { heroToEnv(value); } catch (cause) { error = cause instanceof Error ? cause.message : '请检查时段配置。'; }
  function update(patch: Partial<HeroSlot>) { const key = weatherScene ? 'weather' : 'slots'; onChange({ ...value, [key]: value[key].map(item => item.id === slot.id ? { ...item, ...patch } : item) }); }
  function restore() {
    if (confirm === 'all') onChange(structuredClone(defaultHeroConfig));
    else update(structuredClone([...defaultHeroConfig.slots, ...defaultHeroConfig.weather].find(item => item.id === slot.id)!));
    setConfirm(null);
  }
  function focus(key: 'position' | 'mobilePosition', axis: number, amount: string) {
    const parts = slot[key].split(' ');
    parts[axis] = `${amount}%`;
    update({ [key]: parts.join(' ') });
  }
  return <fieldset className={s.editor} disabled={disabled}>
    <legend className={s.srOnly}>首页光影配置</legend>
    <div className={s.intro}><div><span className={s.eyebrow}>TEN SCENES / EVERY MOMENT</span><h2>让光影，回应时间与天气。</h2><p>一天六幕，加上昼夜雨雪。天气场景拥有独立的手机竖版构图。</p></div><span className={s.tag}>北京时间 · UTC+8</span></div>
    <div className={s.modes}>
      <label className={s.field}>运行方式<select value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as HeroConfig['mode'] })}><option value="auto">随北京时间自动切换</option><option value="weather">随时间与当地天气切换</option><option value="fixed">固定一个主题</option></select></label>
      <label className={s.field}>固定主题<select value={value.fixed} disabled={disabled || value.mode !== 'fixed'} onChange={event => onChange({ ...value, fixed: event.target.value })}>{allScenes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className={s.note}>修改后需“保存并部署”才会发布到首页。发布后每天自动切换，无需重复部署。</p>
    </div>
    <div className={s.weatherStatus}><div><strong>天气服务</strong><p aria-live="polite">{weatherStatus}</p><small>自动更新，无需维护密钥。天气不可用时沿用六时段；固定主题不受天气影响。</small></div><button type="button" className={s.textButton} disabled={disabled || testingWeather} onClick={testWeather}>{testingWeather ? '正在测试…' : '测试连接'}</button></div>
    <div className={s.scenes} aria-label="选择要编辑的时段">{value.slots.map(item => <button type="button" key={item.id} className={`${s.scene} ${slot.id === item.id ? s.active : ''}`} aria-pressed={slot.id === item.id} onClick={() => { setSelected(item.id); setMinute(item.start); setWeather('none'); setConfirm(null); }}><HeroImage src={item.image} position={item.position} /><span>{item.name}<small>{clock(item.start)}</small></span></button>)}</div>
    <div className={`${s.scenes} ${s.weatherScenes}`} aria-label="选择要编辑的天气场景">{value.weather.map(item => <button type="button" key={item.id} className={`${s.scene} ${slot.id === item.id ? s.active : ''}`} aria-pressed={slot.id === item.id} onClick={() => { setSelected(item.id); setWeather(item.id.startsWith('rain') ? 'rain' : 'snow'); setMinute(value.slots.find(scene => scene.id === (item.id.endsWith('day') ? 'day' : 'evening'))!.start); setConfirm(null); }}><HeroImage src={item.image} position={item.position} /><span>{item.name}<small>{item.id.endsWith('day') ? '白昼' : '入夜'}</small></span></button>)}</div>
    <div className={s.layout}>
      <section className={s.fields} aria-label={`${slot.name}内容编辑`}>
        <div className={s.panelHeading}><div><span className={s.eyebrow}>EDIT THE SCENE</span><h3>{slot.name}</h3></div><button type="button" className={s.textButton} onClick={() => setConfirm('slot')}>恢复本幕默认</button></div>
        {weatherScene ? <p className={s.note}>天气模式下，晨光、日间与午后使用白昼场景；黄昏、夜晚与深夜使用入夜场景，跟随六时段的开始时间。</p> : <label className={s.field}>开始时间<input type="time" value={clock(slot.start)} onChange={event => { if (event.target.value) { const [hour, min] = event.target.value.split(':').map(Number); update({ start: hour * 60 + min }); } }} /><small>持续到下一时段开始，深夜自动跨越午夜。</small></label>}
        <label className={s.field}>主标题<textarea rows={2} value={slot.title} maxLength={60} onChange={event => update({ title: event.target.value })} /><small>最多两行，按回车换行；最多 60 个字符。</small></label>
        <label className={s.field}>氛围短句<input value={slot.caption} maxLength={80} onChange={event => update({ caption: event.target.value })} /></label>
        <label className={s.field}>桌面背景图片<input type="text" inputMode="url" value={slot.image} maxLength={500} spellCheck={false} onChange={event => update({ image: event.target.value })} /><small>使用 /images/ 站内路径或 HTTPS 图片地址。</small></label>
        <label className={s.field}>手机背景图片<input type="text" inputMode="url" value={slot.mobileImage} maxLength={500} spellCheck={false} onChange={event => update({ mobileImage: event.target.value })} /><small>{weatherScene ? '默认使用独立 3:4 竖版，保留景物细节与清晰度。' : '默认与桌面共用横图；可单独设置手机构图。'}</small></label>
        <button type="button" className={s.textButton} onClick={() => { const original = [...defaultHeroConfig.slots, ...defaultHeroConfig.weather].find(item => item.id === slot.id)!; update({ image: original.image, mobileImage: original.mobileImage, position: original.position, mobilePosition: original.mobilePosition }); }}>使用本幕默认图片与取景</button>
        <div className={s.focalGrid}>{(['position', 'mobilePosition'] as const).map(key => <div key={key} className={s.focal}><h4>{key === 'position' ? '桌面取景' : '手机取景'}</h4>{['横向', '纵向'].map((label, axis) => <label key={axis}>{label}<input type="range" min={0} max={100} value={parseFloat(slot[key].split(' ')[axis]) || 0} onChange={event => focus(key, axis, event.target.value)} /><output>{parseFloat(slot[key].split(' ')[axis]) || 0}%</output></label>)}</div>)}</div>
        <label className={s.shade}>额外暗色遮罩 <output>{slot.shade}%</output><input type="range" min={0} max={80} value={slot.shade} onChange={event => update({ shade: Number(event.target.value) })} /><small>默认 0%。天气竖图保留清晰景物，仅文字区域加柔和衬底。</small></label>
      </section>
      <section className={s.previewPanel} aria-label="首页效果预览">
        <div className={s.panelHeading}><div><span className={s.eyebrow}>A MOMENT FOR CINEMA</span><h3>穿行于一天的光影</h3></div><div className={s.tabs} aria-label="预览设备"><button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>桌面</button><button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>手机</button></div></div>
        <div className={s.simulation}><span>天气模拟</span><div className={s.tabs} aria-label="模拟天气">{(['none', 'rain', 'snow'] as const).map((kind, index) => <button type="button" key={kind} aria-pressed={weather === kind} onClick={() => setWeather(kind)}>{['晴 / 阴', '下雨', '下雪'][index]}</button>)}</div></div>
        <div className={s.previewStage}><div className={`${s.preview} ${mobile ? s.mobile : ''} ${mobile && weatherPreview ? s.weatherMobile : ''}`}>
          <HeroImage src={mobile ? preview.mobileImage : preview.image} position={mobile ? preview.mobilePosition : preview.position} className={s.previewImage} />
          <div className={s.overlay} style={{ opacity: preview.shade / 100 }} />
          <div className={s.previewCopy}><span>A MOMENT FOR CINEMA</span><h4>{preview.title}</h4><p>{description}</p><small>{preview.caption}</small>{announcement && announcement !== preview.caption && <small>{announcement}</small>}<div className={s.search}><span>搜索电影、剧集…</span><b>搜索</b></div></div>
        </div></div>
        <div className={s.timeline}><label htmlFor="hero-time-preview">时间预览 <output>{clock(minute)}</output></label><input id="hero-time-preview" type="range" min={0} max={1439} value={minute} onChange={event => setMinute(Number(event.target.value))} /><div><span>00:00</span><span>12:00</span><span>23:59</span></div></div>
        <p className={s.previewSummary} aria-live="polite">{preview.name} · 下一时段 {next.name} {clock(next.start)}<br /><span>模拟独立于发布模式，无需天气凭据；当前发布方式：{value.mode === 'auto' ? '六时段自动切换' : value.mode === 'weather' ? '时间与当地天气切换' : `固定${allScenes.find(item => item.id === value.fixed)?.name || ''}`}。</span></p>
        <p className={s.note}>{mobile ? weatherPreview ? '天气手机预览采用独立 3:4 竖版，清晰呈现景物；文字区域使用局部渐变。' : '手机预览按 390px 宽度比例展示。横图默认从右侧取景，保留当前首页的 48% 背景透明度。' : '桌面预览采用 3:1 画幅，文字始终留在左侧。实际首页会随屏幕宽度调整。'}<br />图片加载失败时使用原始海岸图。</p>
      </section>
    </div>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.footer}><span>六时段完整覆盖一天，四个天气场景随昼夜响应。</span><button type="button" className={s.textButton} onClick={() => setConfirm('all')}>恢复全部默认</button></div>
    {confirm && <div className={s.confirm} role="group" aria-label="恢复默认确认"><p>将恢复{confirm === 'all' ? '全部十幕及运行方式' : `“${slot.name}”的文案、图片${weatherScene ? '' : '和时间'}`}。本地草稿修改，保存发布后才影响首页。</p><button type="button" onClick={restore}>确认恢复</button><button type="button" onClick={() => setConfirm(null)}>取消</button></div>}
  </fieldset>;
}

export default HeroEditor;
