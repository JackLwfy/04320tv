'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icon';
import { changes, describeValue, initialSettings, labels, validateSettings, type Section, type Settings, type SourceKind } from './demo-model';
import s from './studio.module.css';

const sections: { id: Section; label: string; icon: IconName; eyebrow: string; description: string }[] = [
  { id: 'site', label: '网站信息', icon: 'gear', eyebrow: 'THE IDENTITY', description: '让每一次相遇，都从一个好印象开始。' },
  { id: 'features', label: '功能设置', icon: 'filter', eyebrow: 'THE EXPERIENCE', description: '决定观众能看到什么，保留恰到好处的体验。' },
  { id: 'sources', label: '数据源', icon: 'link', eyebrow: 'THE COLLECTION', description: '整理内容的入口，让故事有迹可循。' },
  { id: 'playback', label: '播放偏好', icon: 'bolt', eyebrow: 'THE DETAILS', description: '从封面到片尾，照顾每一个观影细节。' },
  { id: 'history', label: '发布记录', icon: 'clock', eyebrow: 'THE RELEASES', description: '每一次调整，都留下清晰的记录。' },
];
type PublishState = 'review' | 'saving' | 'building' | 'verifying' | 'success' | 'failed';
type RecordItem = { id: number; date: string; count: number; failed: boolean };

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
    <header className={s.modalHeader}><div><span className={s.eyebrow}>04320TV / PREVIEW</span><h2>{title}</h2></div><button className={s.iconButton} onClick={onClose} disabled={busy} aria-label="关闭弹窗"><Icon name="close" /></button></header>
    {children}
  </dialog>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (username !== 'admin' || password !== 'demo04320') { setError('演示账号为 admin，演示密码为 demo04320。'); return; }
    setBusy(true);
    timer.current = setTimeout(onLogin, 550);
  }
  return <main className={`${s.studio} ${s.login}`}>
    <section className={s.loginArt} aria-label="灯塔海岸">
      <Image src="/images/cinema-coast.webp" alt="暮色海岸上的灯塔" fill priority sizes="50vw" />
      <div className={s.artCopy}><span className={s.eyebrow}>A MOMENT FOR CINEMA</span><h1>让好故事，<br />持续上映。</h1></div>
      <div className={s.artFooter}><p>光影之间<br />总有下一个故事。</p><span>04320TV / BEHIND THE SCENES</span></div>
    </section>
    <section className={s.loginPanel}>
      <div className={s.loginTop}><Brand /><span className={s.badge}>交互预览</span></div>
      <div className={s.loginForm}>
        <span className={s.eyebrow}>WELCOME BACK</span><h2>进入幕后</h2><p className={s.intro}>属于好故事的另一面，从这里开始。</p>
        <form onSubmit={submit}>
          <label className={s.field}>管理员账号<input name="username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={busy} spellCheck={false} /></label>
          <label className={s.field}>密码<span className={s.password}><input name="password" type={visible ? 'text' : 'password'} autoComplete="off" placeholder="输入演示密码" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="demo-credentials" required disabled={busy} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible}>{visible ? '隐藏' : '显示'}</button></span></label>
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.primary} disabled={busy}>{busy ? '正在进入…' : '登录后台'}<Icon name="arrowDown" className={s.arrow} /></button>
        </form>
        <p className={s.demoHint} id="demo-credentials">演示账号 <code>admin</code> / 密码 <code>demo04320</code><br />仅供界面体验，请勿输入真实密码。</p>
        <Link className={s.backLink} href="/">返回网站 <Icon name="link" /></Link>
      </div>
      <footer className={s.loginFooter}><span>电影让黑暗变得值得等待。</span><span>— 04320TV</span></footer>
    </section>
  </main>;
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [section, setSection] = useState<Section>('site');
  const [draft, setDraft] = useState<Settings>(() => structuredClone(initialSettings));
  const [saved, setSaved] = useState<Settings>(() => structuredClone(initialSettings));
  const [notice, setNotice] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>('vod');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<'discard' | 'logout' | string | null>(null);
  const [publish, setPublish] = useState<PublishState | null>(null);
  const [fail, setFail] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const difference = changes(saved, draft);
  const active = sections.find((item) => item.id === section)!;
  const running = publish === 'saving' || publish === 'building' || publish === 'verifying';

  useEffect(() => {
    if (!difference.length) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [difference.length]);

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      if (publish === 'saving') setPublish('building');
      else if (publish === 'building' && !fail) setPublish('verifying');
      else {
        const failed = publish === 'building';
        setRecords((items) => [{ id: Date.now(), date: new Date().toLocaleString('zh-CN', { hour12: false }), count: difference.length, failed }, ...items]);
        if (!failed) setSaved(structuredClone(draft));
        setPublish(failed ? 'failed' : 'success');
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [publish, running, fail, difference.length, draft]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft((previous) => ({ ...previous, [key]: value })); setNotice(''); }
  function navigate(id: Section) { setSection(id); setNotice(''); requestAnimationFrame(() => titleRef.current?.focus()); }
  function review() {
    const invalid = validateSettings(draft);
    if (invalid) { setSection(invalid.section); setNotice(invalid.message); return; }
    setFail(false); setPublish('review');
  }
  function logout() { setLoggedIn(false); setDraft(structuredClone(initialSettings)); setSaved(structuredClone(initialSettings)); setRecords([]); setSection('site'); setNotice(''); }
  function confirmAction() {
    if (confirm === 'logout') logout();
    else if (confirm === 'discard') { setDraft(structuredClone(saved)); setNotice('已恢复到上次模拟发布的配置。'); }
    else update('sources', draft.sources.filter((item) => item.id !== confirm));
    setConfirm(null);
  }
  function sourceUpdate(id: string, key: 'name' | 'url' | 'enabled', value: string | boolean) {
    update('sources', draft.sources.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }
  function toggle(key: 'live' | 'settings' | 'recommendations' | 'autoplay' | 'adFilter' | 'adultFilter', description: string, global = false) {
    return <div className={s.toggleRow}><div><h3>{labels[key]}<span className={s.scope}>{global ? '全站设置' : '默认偏好'}</span></h3><p>{description}</p></div><button role="switch" aria-checked={draft[key]} aria-label={labels[key]} className={`${s.switch} ${draft[key] ? s.on : ''}`} onClick={() => update(key, !draft[key])}><span /></button></div>;
  }

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  return <div className={s.studio}>
    <a href="#admin-content" className={s.skipLink}>跳到配置内容</a>
    <aside className={s.sidebar}><div className={s.sidebarBrand}><Brand /><span className={s.previewTag}>管理界面预览</span></div>
      <nav aria-label="后台栏目">{sections.map((item) => <button key={item.id} className={`${s.navItem} ${section === item.id ? s.selected : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'history' && records.length > 0 && <small>{records.length}</small>}</button>)}</nav>
      <div className={s.sidebarBottom}><span className={s.eyebrow}>BEHIND THE SCENES</span><p>在光影中，<br />管理更好的故事。</p><Link href="/">返回网站 <Icon name="link" /></Link></div>
    </aside>
    <div className={s.workspace}>
      <header className={s.topbar}><span className={s.breadcrumb}>控制室 <span>/</span> {active.label}</span><div><span className={s.badge}>演示环境 · main</span><Link href="/" target="_blank" rel="noreferrer" className={s.visit}>访问网站 <Icon name="link" /></Link><button className={s.logout} onClick={() => difference.length ? setConfirm('logout') : logout()}>退出登录</button></div></header>
      <div className={s.previewNotice}><Icon name="alert" /><span>交互预览：配置仅在本页演示，刷新后重置，不会修改线上网站。</span></div>
      <main id="admin-content" className={s.main}>
        <div className={s.pageHeading}><span className={s.eyebrow}>{active.eyebrow} <span>/ 0{sections.findIndex((item) => item.id === section) + 1}</span></span><h1 tabIndex={-1} ref={titleRef}>{active.label}</h1><p>{active.description}</p></div>
        {notice && <div className={s.notice} role="status"><Icon name="alert" />{notice}</div>}
        <div className={s.contentGrid}>
          <section className={s.editor} aria-label={active.label}>
            {section === 'site' && <>
              {(['name', 'subtitle', 'description', 'announcement'] as const).map((key) => <label className={s.field} key={key}><span className={s.fieldLabel}>{labels[key]}{key === 'name' && <small>必填</small>}</span><span className={s.inputWrap}>{key === 'description' || key === 'announcement' ? <textarea rows={key === 'announcement' ? 3 : 2} maxLength={200} value={draft[key]} onChange={(e) => update(key, e.target.value)} /> : <input maxLength={50} value={draft[key]} onChange={(e) => update(key, e.target.value)} required={key === 'name'} />}<span className={s.counter}>{draft[key].length}/{key === 'name' || key === 'subtitle' ? 50 : 200}</span></span></label>)}
              <fieldset className={s.logoField}><legend>Logo 样式</legend><div className={s.logoOptions}>{(['a', 'b', 'c'] as const).map((value) => <label key={value} className={draft.logo === value ? s.logoSelected : ''}><input type="radio" name="logo" checked={draft.logo === value} onChange={() => update('logo', value)} /><Image src={`/brand/${value}/logo-dark.svg`} alt={describeValue(value)} width={150} height={36} /><span>{describeValue(value)}</span></label>)}</div></fieldset>
            </>}
            {section === 'features' && <><div className={s.sectionCaption}>网站功能 <span>作用于所有访客</span></div>{toggle('live', '显示直播导航，并开放直播频道功能。', true)}{toggle('settings', '允许访客调整个人偏好及管理本地数据源。', true)}{toggle('recommendations', '在首页展示影视榜单或新番推荐。', true)}<p className={s.footnote}>全站开关应同时作用于页面和服务端接口；当前只演示界面状态。</p></>}
            {section === 'playback' && <>
              <label className={s.field}>默认推荐来源<select value={draft.recommendSource} onChange={(e) => update('recommendSource', e.target.value)}><option value="hot-list">影视热榜</option><option value="douban">豆瓣热门</option><option value="bangumi">新番放送</option></select></label>
              <label className={s.field}>封面加载方式<select value={draft.imageMode} onChange={(e) => update('imageMode', e.target.value)}><option value="direct">直连优先 · 节省代理流量</option><option value="proxy">内置代理优先</option></select></label>
              {toggle('autoplay', '本集结束后，自动衔接下一段故事。')}{toggle('adFilter', '尝试过滤播放列表中的广告片段。')}{toggle('adultFilter', '默认隐藏标记为成人内容的数据源与结果。')}<p className={s.footnote}>作为新访客的默认偏好，不覆盖访客已经做出的个人选择。</p>
            </>}
            {section === 'sources' && <>
              <div className={s.sourceTabs} aria-label="数据源类型">{([['vod', '点播源'], ['live', '直播源'], ['subscription', '订阅链接']] as const).map(([id, label]) => <button key={id} aria-pressed={sourceKind === id} className={sourceKind === id ? s.activeTab : ''} onClick={() => { setSourceKind(id); setQuery(''); }}>{label}<small>{draft.sources.filter((item) => item.kind === id).length}</small></button>)}</div>
              <div className={s.sourceTools}><label className={s.search}><Icon name="search" /><input aria-label="搜索数据源" placeholder="按名称或地址搜索" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button className={s.secondary} onClick={() => { setQuery(''); update('sources', [...draft.sources, { id: crypto.randomUUID(), kind: sourceKind, name: '', url: '', enabled: true }]); }}><Icon name="plus" />添加</button></div>
              <p className={s.footnote}>示例地址不连接真实服务。这里的订阅是数据源订阅，不是邮件订阅。</p>
              {draft.sources.filter((item) => item.kind === sourceKind && `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())).map((item, index) => <fieldset className={s.sourceItem} key={item.id}><legend>来源 {String(index + 1).padStart(2, '0')}</legend><div className={s.sourceActions}><button role="switch" aria-label={`启用${item.name || '新数据源'}`} aria-checked={item.enabled} className={`${s.switch} ${item.enabled ? s.on : ''}`} onClick={() => sourceUpdate(item.id, 'enabled', !item.enabled)}><span /></button><button className={s.iconButton} aria-label={`删除${item.name || '新数据源'}`} onClick={() => setConfirm(item.id)}><Icon name="trash" /></button></div><label className={s.field}>名称<input placeholder="为这个来源命名" maxLength={80} value={item.name} onChange={(e) => sourceUpdate(item.id, 'name', e.target.value)} /></label><label className={s.field}>地址<input type="url" placeholder="https://" value={item.url} maxLength={1000} onChange={(e) => sourceUpdate(item.id, 'url', e.target.value)} spellCheck={false} /></label></fieldset>)}
              {!draft.sources.some((item) => item.kind === sourceKind && `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())) && <div className={s.empty}><Icon name={query ? 'search' : 'link'} /><h3>{query ? '没有找到匹配的来源' : '故事，从一个来源开始。'}</h3><p>{query ? '试试其他关键词，或清空搜索。' : '添加一个订阅链接，整理你的网站内容入口。'}</p>{query && <button className={s.secondary} onClick={() => setQuery('')}>清空搜索</button>}</div>}
            </>}
            {section === 'history' && <>{records.length === 0 ? <div className={s.empty}><Icon name="clock" /><h3>下一次发布，从这里开始。</h3><p>还没有模拟发布记录。修改一项配置，体验完整的发布流程。</p><button className={s.secondary} onClick={() => navigate('site')}>编辑网站信息</button></div> : <div className={s.records}>{records.map((record, index) => <article key={record.id}><div className={`${s.recordIcon} ${record.failed ? s.failure : ''}`}><Icon name={record.failed ? 'alert' : 'check'} /></div><div><h3>{record.failed ? '模拟构建失败' : '模拟发布完成'} <small>#{String(records.length - index).padStart(3, '0')}</small></h3><p>{record.count} 项配置变更 · main</p><time>{record.date}</time></div><span className={s.badge}>演示记录</span></article>)}</div>}<p className={s.footnote}>记录仅保留在当前页面，未调用 EdgeOne，也不代表线上发布。</p></>}
          </section>
          <aside className={s.preview} aria-label="网站预览"><h2>{section === 'history' ? '每一步，都有迹可循。' : '网站预览'}</h2><p>随编辑即时变化，仅供视觉参考。</p><div className={s.previewWindow}><div className={s.previewNav}><Image src={`/brand/${draft.logo}/logo-dark.svg`} alt="网站 Logo 预览" width={120} height={34} /><Icon name="search" /></div><div className={s.previewArt}><Image src="/images/cinema-coast.webp" alt="灯塔海岸首页预览" fill sizes="320px" /><div><span>{draft.subtitle || '光影之间'}</span><h3>把今晚，<br />交给好故事。</h3><p>{draft.announcement || '有些故事，仍在等你。'}</p></div></div><div className={s.previewInfo}><strong>{draft.name || '网站名称'}</strong><p>{draft.description || '网站简介将显示在这里。'}</p><div><span>发现</span>{draft.live && <span>直播</span>}{draft.settings && <span>设置</span>}</div></div></div><div className={s.previewTip}><span className={s.eyebrow}>A NOTE ON PUBLISHING</span><p>好的改变，值得确认。<br />检查变更，再让它与观众见面。</p><span>当前为模拟流程，不影响线上。</span></div></aside>
        </div>
      </main>
      <footer className={s.savebar}><div className={s.saveStatus}><Icon name={difference.length ? 'clock' : 'check'} /><div><strong>{difference.length ? `${difference.length} 项待发布变更` : '所有演示配置已同步'}</strong><small>{difference.length ? '检查变更后，体验模拟部署。' : '编辑任意配置，开始一次新的调整。'}</small></div></div><div className={s.saveActions}><button className={s.secondary} disabled={!difference.length} onClick={() => setConfirm('discard')}>放弃修改</button><button className={s.primary} disabled={!difference.length} onClick={review}>保存并部署<span className={s.simulated}>模拟</span><Icon name="arrowDown" className={s.arrow} /></button></div></footer>
    </div>
    {confirm && <Modal title={confirm === 'discard' ? '放弃这次修改？' : confirm === 'logout' ? '退出控制室？' : '移除这个数据源？'} onClose={() => setConfirm(null)}><p className={s.modalDescription}>{confirm === 'logout' ? '未发布的演示修改将丢失，退出后本页数据会重置。' : confirm === 'discard' ? '恢复到上次模拟发布的内容。这不会修改线上配置。' : '只移除当前演示列表中的来源。发布前可以通过“放弃修改”恢复。'}</p><div className={s.modalActions}><button className={s.secondary} onClick={() => setConfirm(null)} autoFocus>继续编辑</button><button className={s.primary} onClick={confirmAction}>确认{confirm === 'logout' ? '退出' : confirm === 'discard' ? '放弃' : '移除'}</button></div></Modal>}
    {publish && <Modal title={publish === 'success' ? '这次调整，准备好了。' : publish === 'failed' ? '发布暂未完成' : '让改变，正式开场。'} busy={running} onClose={() => setPublish(null)}>
      <p className={s.modalDescription}>模拟发布 · 不会保存环境变量，也不会触发真实部署。</p>
      {publish === 'review' && <><div className={s.diffList}>{difference.map((key) => <div key={key}><strong>{labels[key]}</strong><span><small>修改前</small>{describeValue(saved[key])}</span><span className={s.newValue}><small>修改后</small>{describeValue(draft[key])}</span></div>)}</div><p className={s.footnote}>变更统计按配置项计算。部署分支：main（演示）。</p><label className={s.failChoice}><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />测试构建失败状态</label><div className={s.modalActions}><button className={s.secondary} onClick={() => setPublish(null)}>返回编辑</button><button className={s.primary} onClick={() => setPublish('saving')}>开始模拟部署<Icon name="arrowDown" className={s.arrow} /></button></div></>}
      {publish !== 'review' && <><ol className={s.steps} aria-label="模拟发布进度">{(['保存配置', '构建部署', '核对生效'] as const).map((label, index) => { const current = publish === 'saving' ? 0 : publish === 'building' || publish === 'failed' ? 1 : publish === 'verifying' ? 2 : 3; return <li key={label} className={index < current ? s.stepDone : index === current ? s.stepActive : ''}><span>{index < current ? <Icon name="check" /> : `0${index + 1}`}</span><div><strong>{label}</strong><small>{index < current ? '演示步骤已完成' : index === current ? publish === 'failed' ? '模拟失败' : '正在模拟…' : '等待上一步完成'}</small></div></li>; })}</ol><div role="status" aria-live="polite" className={publish === 'failed' ? s.error : s.publishStatus}>{publish === 'success' ? '模拟发布完成。本页预览已更新，线上网站未改变。' : publish === 'failed' ? '已模拟一次构建失败。修改仍然保留，可以重试。' : '正在演示发布流程，请稍候。'}</div>{!running && <div className={s.modalActions}><button className={s.secondary} onClick={() => setPublish(null)}>返回管理界面</button>{publish === 'failed' ? <button className={s.primary} onClick={() => { setFail(false); setPublish('saving'); }}>重试模拟发布</button> : <button className={s.primary} onClick={() => { setPublish(null); navigate('history'); }}>查看发布记录</button>}</div>}</>}
    </Modal>}
  </div>;
}
