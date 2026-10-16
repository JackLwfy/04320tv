'use client';

import Image from 'next/image';
import { AdminAnalytics } from '@/components/admin-analytics';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icon';
import { changes, describeValue, initialSettings, labels, validateSettings, type Section, type Settings, type SourceKind } from '@/lib/admin-settings';
import s from './studio.module.css';
import { NewsletterDialog, type NewsletterState } from '@/components/newsletter-dialog';
import { HeroEditor } from '@/components/hero-editor';

const sections: { id: Section; label: string; icon: IconName; eyebrow: string; description: string }[] = [
  { id: 'site', label: '网站信息', icon: 'gear', eyebrow: 'THE IDENTITY', description: '让每一次相遇，都从一个好印象开始。' },
  { id: 'hero', label: '首页光影', icon: 'clock', eyebrow: 'TEN SCENES, EVERY MOMENT', description: '让时间与天气，陪观众走进不同的故事。' },
  { id: 'features', label: '功能设置', icon: 'filter', eyebrow: 'THE EXPERIENCE', description: '决定观众能看到什么，保留恰到好处的体验。' },
  { id: 'sources', label: '数据源', icon: 'link', eyebrow: 'THE COLLECTION', description: '整理内容的入口，让故事有迹可循。' },
  { id: 'playback', label: '播放偏好', icon: 'bolt', eyebrow: 'THE DETAILS', description: '从封面到片尾，照顾每一个观影细节。' },
  { id: 'history', label: '发布记录', icon: 'clock', eyebrow: 'THE RELEASES', description: '每一次调整，都留下清晰的记录。' },
  { id: 'newsletter', label: '邮件订阅', icon: 'link', eyebrow: 'LETTERS FROM CINEMA', description: '选一种方式，把下一段好故事寄给观众。' },
  { id: 'analytics', label: '数据统计', icon: 'bolt', eyebrow: 'THE AUDIENCE', description: '看见每一次寻找，也照顾每一次播放。' },
];
type PublishState = 'review' | 'saving' | 'building' | 'verifying' | 'success' | 'failed';
type RecordItem = { id: string; date: string; status: string; commit: string; message: string; branch: string };
type Snapshot = { settings: Settings; accessPasswordConfigured: boolean; revision: string; configuredRevision: string; deployedRevision: string };
const statusNames: Record<string, string> = { Success: '发布成功', Failed: '构建失败', Timeout: '构建超时', Cancelled: '已取消', Invalid: '部署无效', Expired: '历史部署' };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请稍后重试。');
  return result;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : '请求失败，请检查网络后重试。'; }

function Brand() {
  return <div className={s.brand}><span>04320<span className={s.tv}>TV</span></span><small>暗 场 控 制 室</small></div>;
}

function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={s.modal} aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className={s.modalHeader}><div><span className={s.eyebrow}>04320TV / CONTROL ROOM</span><h2>{title}</h2></div><button className={s.iconButton} onClick={onClose} disabled={busy} aria-label="关闭弹窗"><Icon name="close" /></button></header>
    {children}
  </dialog>;
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await request('session', 'POST', { username, password }); setPassword(''); await onLogin(); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <main className={`${s.studio} ${s.login}`}>
    <section className={s.loginArt} aria-label="灯塔海岸">
      <Image src="/images/cinema-coast.webp" alt="暮色海岸上的灯塔" fill priority sizes="50vw" />
      <div className={s.artCopy}><span className={s.eyebrow}>A MOMENT FOR CINEMA</span><h1>让好故事，<br />持续上映。</h1></div>
      <div className={s.artFooter}><p>光影之间<br />总有下一个故事。</p><span>04320TV / BEHIND THE SCENES</span></div>
    </section>
    <section className={s.loginPanel}>
      <div className={s.loginTop}><Brand /><span className={s.badge}>管理员登录</span></div>
      <div className={s.loginForm}>
        <span className={s.eyebrow}>WELCOME BACK</span><h2>进入幕后</h2><p className={s.intro}>属于好故事的另一面，从这里开始。</p>
        <form onSubmit={submit}>
          <label className={s.field}>管理员账号<input name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={busy} spellCheck={false} /></label>
          <label className={s.field}>密码<span className={s.password}><input name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="输入管理员密码" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible}>{visible ? '隐藏' : '显示'}</button></span></label>
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.primary} disabled={busy}>{busy ? '正在进入…' : '登录后台'}<Icon name="arrowDown" className={s.arrow} /></button>
        </form>
        <p className={s.demoHint}>仅供网站管理员使用。<br />登录状态有效期为 8 小时，请在使用后退出。</p>
        <Link className={s.backLink} href="/">返回网站 <Icon name="link" /></Link>
      </div>
      <footer className={s.loginFooter}><span>电影让黑暗变得值得等待。</span><span>— 04320TV</span></footer>
    </section>
  </main>;
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [section, setSection] = useState<Section>('site');
  const [newsletterPreview, setNewsletterPreview] = useState(false);
  const [newsletterState, setNewsletterState] = useState<NewsletterState>('form');
  const [draft, setDraft] = useState<Settings>(() => structuredClone(initialSettings));
  const [saved, setSaved] = useState<Settings>(() => structuredClone(initialSettings));
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [accessPasswordConfigured, setAccessPasswordConfigured] = useState(false);
  const [notice, setNotice] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>('vod');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<'discard' | 'logout' | string | null>(null);
  const [publish, setPublish] = useState<PublishState | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState('');
  const [configuredRevision, setConfiguredRevision] = useState('');
  const [deployedRevision, setDeployedRevision] = useState('');
  const [deploymentId, setDeploymentId] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const difference = changes(saved, draft);
  const changeCount = difference.length + (accessPassword !== null ? 1 : 0);
  const active = sections.find((item) => item.id === section)!;
  const running = publish === 'saving' || publish === 'building' || publish === 'verifying';
  const needsDeployment = configuredRevision !== deployedRevision;
  const applySnapshot = useCallback((value: Snapshot) => {
    setAccessPassword(null); setAccessPasswordConfigured(value.accessPasswordConfigured);
    setDraft(value.settings); setSaved(structuredClone(value.settings)); setRevision(value.revision);
    setConfiguredRevision(value.configuredRevision); setDeployedRevision(value.deployedRevision);
  }, []);
  const load = useCallback(async () => {
    const [config, history] = await Promise.all([request<Snapshot>('config'), request<{ records: RecordItem[] }>('deployments')]);
    applySnapshot(config); setRecords(history.records); setLoggedIn(true); setLoadError('');
  }, [applySnapshot]);

  useEffect(() => {
    request<{ verified: boolean }>('session').then(async session => { if (session.verified) await load(); }).catch(error => setLoadError(errorText(error))).finally(() => setChecking(false));
  }, [load]);

  useEffect(() => {
    if (!changeCount) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [changeCount]);

  useEffect(() => {
    if (!deploymentId) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; const started = Date.now();
    async function poll() {
      try {
        const result = await request<{ records: RecordItem[]; deployedRevision: string }>('deployments');
        if (stopped) return;
        setRecords(result.records); setDeployedRevision(result.deployedRevision);
        const record = result.records.find(item => item.id === deploymentId);
        if (record?.status === 'Success') {
          if (result.deployedRevision === configuredRevision) { setPublish('success'); setPublishMessage('发布完成，当前网站已加载本次配置。'); setDeploymentId(''); return; }
          setPublish('verifying'); setPublishMessage('构建已成功，正在等待生产节点加载新配置…');
        } else if (record && statusNames[record.status]) {
          setPublish('failed'); setPublishMessage(`${statusNames[record.status]}。配置已保存在云端，可以重新部署。`); setDeploymentId(''); return;
        } else { setPublish('building'); setPublishMessage('EdgeOne 正在构建部署，通常需要几分钟。请勿重复提交。'); }
      } catch (error) { if (!stopped) setPublishMessage(`暂时无法读取状态：${errorText(error)} 正在重试…`); }
      if (stopped) return;
      if (Date.now() - started > 15 * 60 * 1000) { setPublish('failed'); setPublishMessage('等待已超过 15 分钟，请刷新发布记录确认云端结果。'); setDeploymentId(''); return; }
      timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [deploymentId, configuredRevision]);

  async function publishChanges() {
    setPublish('saving'); setPublishMessage('正在保存配置并提交生产部署…');
    try {
      const result = await request<Snapshot & { deploymentId?: string; deploymentError?: string }>('config', 'POST', { settings: draft, revision, ...(accessPassword !== null ? { accessPassword } : {}) });
      applySnapshot(result);
      if (result.deploymentId) { setDeploymentId(result.deploymentId); setPublish('building'); }
      else { setPublish('failed'); setPublishMessage(result.deploymentError || '配置已保存，请刷新发布记录。'); }
    } catch (error) { setPublish('failed'); setPublishMessage(errorText(error)); }
  }
  async function retryDeployment() {
    setPublish('saving'); setPublishMessage('正在确认云端配置和发布状态…');
    try {
      const config = await request<Snapshot>('config'); applySnapshot(config);
      if (config.configuredRevision === config.deployedRevision) { setPublish('success'); setPublishMessage('当前云端配置已经生效。'); return; }
      const result = await request<{ deploymentId: string }>('deployments', 'POST', {});
      setDeploymentId(result.deploymentId); setPublish('building');
    } catch (error) { setPublish('failed'); setPublishMessage(errorText(error)); }
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft((previous) => ({ ...previous, [key]: value })); setNotice(''); }
  function navigate(id: Section) { setSection(id); setNotice(''); requestAnimationFrame(() => titleRef.current?.focus()); if (id === 'history') void refreshHistory(); }
  async function refreshHistory() { try { const result = await request<{ records: RecordItem[]; deployedRevision: string }>('deployments'); setRecords(result.records); setDeployedRevision(result.deployedRevision); } catch (error) { setNotice(errorText(error)); } }
  function review() {
    if (accessPassword !== null && (new TextEncoder().encode(accessPassword).length > 1000 || /[\x00-\x1f\x7f]/.test(accessPassword))) { setSection('site'); setNotice('网站访问密码不能超过 1000 字节或包含控制字符。'); return; }
    const invalid = validateSettings(draft);
    if (invalid) { setSection(invalid.section); setNotice(invalid.message); return; }
    setPublish('review');
  }
  async function logout() { try { await request('session', 'DELETE'); setLoggedIn(false); setAccessPassword(null); setDraft(structuredClone(initialSettings)); setSaved(structuredClone(initialSettings)); setRecords([]); setSection('site'); setNotice(''); setDeploymentId(''); } catch (error) { setNotice(errorText(error)); } }
  function confirmAction() {
    if (confirm === 'logout') logout();
    else if (confirm === 'reload') { void load().catch(error => setNotice(errorText(error))); }
    else if (confirm === 'discard') { setDraft(structuredClone(saved)); setAccessPassword(null); setNotice('已恢复到最近读取的云端配置。'); }
    else update('sources', draft.sources.filter((item) => item.id !== confirm));
    setConfirm(null);
  }
  function sourceUpdate(id: string, key: 'name' | 'url' | 'enabled', value: string | boolean) {
    update('sources', draft.sources.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }
  function toggle(key: 'live' | 'settings' | 'recommendations' | 'autoplay' | 'adFilter' | 'adultFilter' | 'newsletterEnabled', description: string, global = false) {
    return <div className={s.toggleRow}><div><h3>{labels[key]}<span className={s.scope}>{global ? '全站设置' : '默认偏好'}</span></h3><p>{description}</p></div><button role="switch" aria-checked={draft[key]} aria-label={labels[key]} className={`${s.switch} ${draft[key] ? s.on : ''}`} onClick={() => update(key, !draft[key])}><span /></button></div>;
  }

  if (checking) return <main className={s.studio}><div className={s.empty} role="status">正在核对管理员会话…</div></main>;
  if (!loggedIn) return <><Login onLogin={load} />{loadError && <div className={s.error} role="alert">{loadError}</div>}</>;

  return <div className={s.studio}>
    {newsletterPreview && <NewsletterDialog style={draft.newsletterStyle} previewState={newsletterState} onClose={() => setNewsletterPreview(false)} />}
    <a href="#admin-content" className={s.skipLink}>跳到配置内容</a>
    <aside className={s.sidebar}><div className={s.sidebarBrand}><Brand /><span className={s.previewTag}>网站管理</span></div>
      <nav aria-label="后台栏目">{sections.map((item) => <button key={item.id} className={`${s.navItem} ${section === item.id ? s.selected : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'history' && records.length > 0 && <small>{records.length}</small>}</button>)}</nav>
      <div className={s.sidebarBottom}><span className={s.eyebrow}>BEHIND THE SCENES</span><p>在光影中，<br />管理更好的故事。</p><Link href="/">返回网站 <Icon name="link" /></Link></div>
    </aside>
    <div className={s.workspace}>
      <header className={s.topbar}><span className={s.breadcrumb}>控制室 <span>/</span> {active.label}</span><div><span className={s.badge}>生产环境 · main</span><Link href="/" target="_blank" rel="noreferrer" className={s.visit}>访问网站 <Icon name="link" /></Link><button className={s.logout} onClick={() => changeCount ? setConfirm('logout') : logout()}>退出登录</button></div></header>
      {section !== 'analytics' && <div className={s.previewNotice}><Icon name="alert" /><span>配置保存到 EdgeOne，完成构建后生效。关闭页面不会中断已提交的部署。</span></div>}
      <main id="admin-content" className={`${s.main} ${section === 'analytics' ? s.analyticsMain : ''}`}>
        <div className={s.pageHeading}><span className={s.eyebrow}>{active.eyebrow} <span>/ 0{sections.findIndex((item) => item.id === section) + 1}</span></span><h1 tabIndex={-1} ref={titleRef}>{active.label}</h1><p>{active.description}</p></div>
        {section === 'analytics' ? <AdminAnalytics /> : <>
        {notice && <div className={s.notice} role="status"><Icon name="alert" />{notice}</div>}<div className={s.cloudTools}><span>04320.com · EdgeOne</span><button className={s.secondary} disabled={running} onClick={() => setConfirm('reload')}>重新读取配置</button></div>
        <div className={`${s.contentGrid} ${section === 'hero' ? s.heroGrid : ''}`}>
          <section className={s.editor} aria-label={active.label}>
            {section === 'hero' && <HeroEditor value={draft.hero} onChange={hero => update('hero', hero)} disabled={running} description={draft.description} announcement={draft.announcement} />}
            {section === 'newsletter' && <>
              {toggle('newsletterEnabled', '首页访问验证通过后延迟弹出；当天关闭或订阅成功后不再自动弹出。页脚保留手动入口。', true)}
              <fieldset className={s.newsletterChoices}><legend>弹窗样式</legend>{([['lighthouse', '灯塔来信', '海岸画面与表单并列，延续首页的电影感。'], ['ticket', '电影票根', '用一张票根，邀请观众加入光影来信。'], ['minimal', '极简片尾', '收起图片，用文字和留白聚焦订阅。']] as const).map(([value, title, description]) => <label key={value} className={draft.newsletterStyle === value ? s.newsletterSelected : ''}><input type="radio" name="newsletter-style" checked={draft.newsletterStyle === value} onChange={() => update('newsletterStyle', value)} /><Image src={`/images/newsletter-${value}.png`} alt={`${title}设计参考`} width={480} height={320} /><strong>{title}</strong><span>{description}</span></label>)}</fieldset>
              <label className={s.field}>预览状态<select value={newsletterState} onChange={e => setNewsletterState(e.target.value as NewsletterState)}><option value="form">填写邮箱</option><option value="submitting">正在提交</option><option value="accepted">已收到订阅请求（当前接口）</option><option value="error">提交失败</option><option value="unavailable">服务暂未开放</option></select></label>
              <button className={s.primary} onClick={() => setNewsletterPreview(true)}>预览所选弹窗<Icon name="link" /></button>
              <p className={s.footnote}>预览不会收集邮箱或发送邮件。前台收到订阅服务的受理响应后才显示“订阅请求已收到”；这不代表邮件已送达。</p>
            </>}
            {section === 'site' && <>
              <div className={s.toggleRow}><div><h3>网站访问密码<span className={s.scope}>全站设置</span></h3><p>{accessPasswordConfigured ? '已设置访问密码，现有密码不会回显。' : '无需密码，访客可直接访问。'} 管理员登录密码不受影响。</p></div><button className={s.secondary} disabled={running} onClick={() => setAccessPassword(accessPassword === null ? '' : null)}>{accessPassword === null ? '修改访问密码' : '取消密码修改'}</button></div>
              {accessPassword !== null && <label className={s.field}>新的网站访问密码<input type="password" autoComplete="new-password" value={accessPassword} onChange={e => setAccessPassword(e.target.value)} maxLength={1000} placeholder="留空则移除访问密码" disabled={running} /><span className={s.footnote}>{accessPassword === '' ? '保存并部署后将移除访问密码，所有访客均可直接访问。' : '保存并部署后新密码生效，原有访问会话将失效。'}</span></label>}
              {(['name', 'subtitle', 'description', 'announcement'] as const).map((key) => <label className={s.field} key={key}><span className={s.fieldLabel}>{labels[key]}{key === 'name' && <small>必填</small>}</span><span className={s.inputWrap}>{key === 'description' || key === 'announcement' ? <textarea rows={key === 'announcement' ? 3 : 2} maxLength={200} value={draft[key]} onChange={(e) => update(key, e.target.value)} /> : <input maxLength={50} value={draft[key]} onChange={(e) => update(key, e.target.value)} required={key === 'name'} />}<span className={s.counter}>{draft[key].length}/{key === 'name' || key === 'subtitle' ? 50 : 200}</span></span></label>)}
              <fieldset className={s.logoField}><legend>Logo 样式</legend><div className={s.logoOptions}>{(['a', 'b', 'c'] as const).map((value) => <label key={value} className={draft.logo === value ? s.logoSelected : ''}><input type="radio" name="logo" checked={draft.logo === value} onChange={() => update('logo', value)} /><Image src={`/brand/${value}/logo-dark.svg`} alt={describeValue(value)} width={150} height={36} /><span>{describeValue(value)}</span></label>)}</div></fieldset>
            </>}
            {section === 'features' && <><div className={s.sectionCaption}>网站功能 <span>作用于所有访客</span></div>{toggle('live', '显示直播导航，并开放直播频道功能。', true)}{toggle('settings', '允许访客调整个人偏好及管理本地数据源。', true)}{toggle('recommendations', '在首页展示影视榜单或新番推荐。', true)}<p className={s.footnote}>直播和前台设置入口按全站开关生效，首页推荐控制首页内容展示。</p></>}
            {section === 'playback' && <>
              <label className={s.field}>默认推荐来源<select value={draft.recommendSource} onChange={(e) => update('recommendSource', e.target.value)}><option value="hot-list">影视热榜</option><option value="douban">豆瓣热门</option><option value="bangumi">新番放送</option></select></label>
              <label className={s.field}>封面加载方式<select value={draft.imageMode} onChange={(e) => update('imageMode', e.target.value)}><option value="direct">直连优先 · 节省代理流量</option><option value="proxy">内置代理优先</option></select></label>
              {toggle('autoplay', '本集结束后，自动衔接下一段故事。')}{toggle('adFilter', '尝试过滤播放列表中的广告片段。')}{toggle('adultFilter', '默认隐藏标记为成人内容的数据源与结果。')}<p className={s.footnote}>作为新访客的默认偏好，不覆盖访客已经做出的个人选择。</p>
            </>}
            {section === 'sources' && <>
              <div className={s.sourceTabs} aria-label="数据源类型">{([['vod', '点播源'], ['live', '直播源'], ['subscription', '订阅链接']] as const).map(([id, label]) => <button key={id} aria-pressed={sourceKind === id} className={sourceKind === id ? s.activeTab : ''} onClick={() => { setSourceKind(id); setQuery(''); }}>{label}<small>{draft.sources.filter((item) => item.kind === id).length}</small></button>)}</div>
              <div className={s.sourceTools}><label className={s.search}><Icon name="search" /><input aria-label="搜索数据源" placeholder="按名称或地址搜索" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button className={s.secondary} onClick={() => { setQuery(''); update('sources', [...draft.sources, { id: crypto.randomUUID(), kind: sourceKind, name: '', url: '', enabled: true }]); }}><Icon name="plus" />添加</button></div>
              <p className={s.footnote}>每类数据源需在 1000 字节内，大量片源请使用订阅链接。既有详情、EPG 等附加字段会保留。</p>
              {draft.sources.filter((item) => item.kind === sourceKind && `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())).map((item, index) => <fieldset className={s.sourceItem} key={item.id}><legend>来源 {String(index + 1).padStart(2, '0')}</legend><div className={s.sourceActions}><button role="switch" aria-label={`启用${item.name || '新数据源'}`} aria-checked={item.enabled} className={`${s.switch} ${item.enabled ? s.on : ''}`} onClick={() => sourceUpdate(item.id, 'enabled', !item.enabled)}><span /></button><button className={s.iconButton} aria-label={`删除${item.name || '新数据源'}`} onClick={() => setConfirm(item.id)}><Icon name="trash" /></button></div><label className={s.field}>名称<input placeholder="为这个来源命名" maxLength={80} value={item.name} onChange={(e) => sourceUpdate(item.id, 'name', e.target.value)} /></label><label className={s.field}>地址<input type="url" placeholder="https://" value={item.url} maxLength={1000} onChange={(e) => sourceUpdate(item.id, 'url', e.target.value)} spellCheck={false} /></label></fieldset>)}
              {!draft.sources.some((item) => item.kind === sourceKind && `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())) && <div className={s.empty}><Icon name={query ? 'search' : 'link'} /><h3>{query ? '没有找到匹配的来源' : '故事，从一个来源开始。'}</h3><p>{query ? '试试其他关键词，或清空搜索。' : '添加一个订阅链接，整理你的网站内容入口。'}</p>{query && <button className={s.secondary} onClick={() => setQuery('')}>清空搜索</button>}</div>}
            </>}
            {section === 'history' && <><button className={s.secondary} onClick={refreshHistory}>刷新发布记录</button>{records.length === 0 ? <div className={s.empty}><Icon name="clock" /><h3>下一次发布，从这里开始。</h3><p>暂未读取到生产发布记录。</p></div> : <div className={s.records}>{records.map(record => <article key={record.id}><div className={`${s.recordIcon} ${['Failed', 'Timeout', 'Invalid'].includes(record.status) ? s.failure : ''}`}><Icon name={record.status === 'Success' ? 'check' : 'clock'} /></div><div><h3>{statusNames[record.status] || '部署进行中'}</h3><p>{record.id} · {record.branch} · {record.commit}</p><time>{new Date(record.date).toLocaleString('zh-CN', { hour12: false })}</time></div><span className={s.badge}>EdgeOne</span></article>)}</div>}<p className={s.footnote}>显示 EdgeOne 最近的生产部署记录。构建成功后，仍需等待生产节点更新。</p></>}

          </section>
          <aside className={s.preview} aria-label="网站预览"><h2>{section === 'history' ? '每一步，都有迹可循。' : '网站预览'}</h2><p>随编辑即时变化，仅供视觉参考。</p><div className={s.previewWindow}><div className={s.previewNav}><Image src={`/brand/${draft.logo}/logo-dark.svg`} alt="网站 Logo 预览" width={120} height={34} /><Icon name="search" /></div><div className={s.previewArt}><Image src="/images/cinema-coast.webp" alt="灯塔海岸首页预览" fill sizes="320px" /><div><span>{draft.subtitle || '光影之间'}</span><h3>把今晚，<br />交给好故事。</h3><p>{draft.announcement || '有些故事，仍在等你。'}</p></div></div><div className={s.previewInfo}><strong>{draft.name || '网站名称'}</strong><p>{draft.description || '网站简介将显示在这里。'}</p><div><span>发现</span>{draft.live && <span>直播</span>}{draft.settings && <span>设置</span>}</div></div></div><div className={s.previewTip}><span className={s.eyebrow}>A NOTE ON PUBLISHING</span><p>好的改变，值得确认。<br />检查变更，再让它与观众见面。</p><span>保存并部署后更新线上网站。</span></div></aside>
        </div>
        </>}
      </main>
      {section !== 'analytics' && <footer className={s.savebar}><div className={s.saveStatus}><Icon name={changeCount || needsDeployment ? 'clock' : 'check'} /><div><strong>{changeCount ? `${changeCount} 项未保存变更` : needsDeployment ? '配置已保存，等待部署生效' : '云端配置已同步'}</strong><small>{changeCount ? '确认变更后，保存并发布到线上。' : '修改配置后需要重新构建，通常需要几分钟。'}</small></div></div><div className={s.saveActions}><button className={s.secondary} disabled={!changeCount || running} onClick={() => setConfirm('discard')}>放弃修改</button><button className={s.primary} disabled={running || (!changeCount && !needsDeployment)} onClick={changeCount ? review : retryDeployment}>{changeCount ? '保存并部署' : needsDeployment ? '继续发布' : '保存并部署'}<Icon name="arrowDown" className={s.arrow} /></button></div></footer>}
    </div>
    {confirm && <Modal title={confirm === 'discard' ? '放弃这次修改？' : confirm === 'logout' ? '退出控制室？' : confirm === 'reload' ? '重新读取云端配置？' : '移除这个数据源？'} onClose={() => setConfirm(null)}><p className={s.modalDescription}>{confirm === 'logout' ? '未保存的修改将丢失，已提交的部署会继续执行。' : confirm === 'reload' ? '将丢弃本页尚未保存的修改，并载入当前云端配置。' : confirm === 'discard' ? '恢复到最近读取的云端内容，不会修改线上配置。' : '保存并部署后，此来源将从网站预置数据源中移除。'}</p><div className={s.modalActions}><button className={s.secondary} onClick={() => setConfirm(null)} autoFocus>继续编辑</button><button className={s.primary} onClick={confirmAction}>确认{confirm === 'logout' ? '退出' : confirm === 'discard' ? '放弃' : confirm === 'reload' ? '读取' : '移除'}</button></div></Modal>}
    {publish && <Modal title={publish === 'success' ? '这次调整，已正式上线。' : publish === 'failed' ? '发布暂未完成' : '让改变，正式开场。'} busy={running} onClose={() => setPublish(null)}>
      <p className={s.modalDescription}>生产发布 · 先保存配置，再由 EdgeOne 重新构建网站。</p>
      {publish === 'review' && <><div className={s.diffList}>{accessPassword !== null && <div><strong>网站访问密码</strong><span><small>修改前</small>{accessPasswordConfigured ? '已设置' : '无需密码'}</span><span className={s.newValue}><small>修改后</small>{accessPassword === '' ? '移除密码，开放访问' : '设置新密码（不显示内容）'}</span></div>}{difference.map(key => <div key={key}><strong>{labels[key]}</strong><span><small>修改前</small>{describeValue(saved[key])}</span><span className={s.newValue}><small>修改后</small>{describeValue(draft[key])}</span></div>)}</div><p className={s.footnote}>变更统计按配置项计算。目标网站：04320.com，部署分支：main。</p><div className={s.modalActions}><button className={s.secondary} onClick={() => setPublish(null)}>返回编辑</button><button className={s.primary} onClick={publishChanges}>确认保存并部署<Icon name="arrowDown" className={s.arrow} /></button></div></>}
      {publish !== 'review' && <><ol className={s.steps} aria-label="发布进度">{(['保存配置', '构建部署', '核对生效'] as const).map((label, index) => { const current = publish === 'saving' ? 0 : publish === 'building' ? 1 : publish === 'verifying' ? 2 : publish === 'success' ? 3 : -1; return <li key={label} className={index < current ? s.stepDone : index === current ? s.stepActive : ''}><span>{index < current ? <Icon name="check" /> : `0${index + 1}`}</span><div><strong>{label}</strong><small>{index < current ? '已完成' : index === current ? '正在处理…' : publish === 'failed' ? '请查看下方结果' : '等待上一步完成'}</small></div></li>; })}</ol><div role="status" aria-live="polite" className={publish === 'failed' ? s.error : s.publishStatus}>{publishMessage}</div>{!running && <div className={s.modalActions}><button className={s.secondary} onClick={() => setPublish(null)}>返回管理界面</button>{publish === 'failed' && needsDeployment && !changeCount ? <button className={s.primary} onClick={retryDeployment}>重新部署</button> : <button className={s.primary} onClick={() => { setPublish(null); navigate('history'); }}>查看发布记录</button>}</div>}</>}
    </Modal>}
  </div>;
}
