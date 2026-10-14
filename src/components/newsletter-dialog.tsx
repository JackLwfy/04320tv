'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';
import { useFocusTrap } from './use-focus-trap';
import styles from './newsletter-dialog.module.css';
import { trackAnalytics } from '@/lib/analytics-client';

export type NewsletterStyle = 'lighthouse' | 'ticket' | 'minimal';
export type NewsletterState = 'form' | 'submitting' | 'accepted' | 'error' | 'unavailable';

export function NewsletterDialog({ style, onClose, onAccepted, previewState }: {
  style: NewsletterStyle;
  onClose: () => void;
  onAccepted?: () => void;
  previewState?: NewsletterState;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<NewsletterState>('form');
  const [mounted, setMounted] = useState(false);
  const preview = previewState !== undefined;
  const visibleState = previewState ?? state;
  const tracked = useRef(false);
  useEffect(() => { if (!preview && !tracked.current) { tracked.current = true; trackAnalytics({ type: 'newsletter_impression' }); } }, [preview]);
  const close = useCallback(() => { if (!preview) trackAnalytics({ type: 'newsletter_close' }); onClose(); }, [preview, onClose]);
  const complete = visibleState === 'accepted';
  const busy = visibleState === 'submitting';
  useFocusTrap(mounted, panelRef);

  useEffect(() => {
    setMounted(true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestRef.current?.abort();
        close();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    trackAnalytics({ type: 'newsletter_submit' });
    setState('submitting');
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
        signal: controller.signal,
      });
      if (response.status === 503) {
        trackAnalytics({ type: 'newsletter_error', errorCode: 'unavailable' });
        setState('unavailable');
        return;
      }
      const result = await response.json();
      if (!response.ok || result.status !== 'accepted') {
        trackAnalytics({ type: 'newsletter_error', errorCode: 'rejected' });
        setState('error');
        return;
      }
      trackAnalytics({ type: 'newsletter_accepted' });
      setState('accepted');
      onAccepted?.();
    } catch {
      trackAnalytics({ type: 'newsletter_error', errorCode: 'request_failed' });
      setState('error');
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
    }
  }

  const title = visibleState === 'accepted' ? '订阅请求已收到。'
    : style === 'ticket' ? '给好故事，\n留一个座位。' : style === 'minimal' ? '好故事，\n值得再见。' : '把下一段好故事，\n寄给你。';
  const description = visibleState === 'accepted' ? '后续光影来信，请留意你的邮箱。'
    : style === 'ticket' ? '精选片单与网站更新，寄到你的邮箱。'
    : style === 'minimal' ? '订阅精选片单与网站更新，\n让下一次相遇，发生在邮箱里。'
    : '订阅精选片单与网站更新，让值得看的故事，不再错过。';

  if (!mounted) return null;

  return createPortal(
    <div className={styles.overlay} onClick={(event) => {
      if (event.target === event.currentTarget) { requestRef.current?.abort(); close(); }
    }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`} className={`${styles.dialog} ${styles[style]}`}>
        <button type="button" className={styles.close} aria-label="关闭订阅弹窗" onClick={() => {
          requestRef.current?.abort(); close();
        }}><Icon name="close" /></button>
        {style === 'lighthouse' && <div className={styles.coast} aria-hidden="true">
          <span className={styles.imageCaption}>来自光影的一封信</span>
        </div>}
        <div className={styles.content}>
          {preview && <span className={styles.preview}>设计预览 · 不会提交邮箱或发送邮件</span>}
          <div className={styles.eyebrow}>04320TV<span /></div>
          {complete && <div className={styles.resultIcon} aria-hidden="true"><Icon name="clock" /></div>}
          <div aria-live="polite" aria-atomic="true">
            <h2 id={`${id}-title`} className={styles.title}>{title}</h2>
            <p id={`${id}-description`} className={styles.description}>{description}</p>
          </div>
          {complete ? <div className={styles.result}>
            <p className={styles.resultNote}>也可以检查垃圾邮件文件夹。</p>
            <button type="button" className={styles.submit} onClick={close}>知道了<span aria-hidden="true">→</span></button>
          </div> : <form onSubmit={submit} className={styles.form} aria-busy={busy}>
            <label htmlFor={`${id}-email`}>电子邮箱</label>
            <input id={`${id}-email`} name="email" type="email" required maxLength={254}
              autoComplete={preview ? 'off' : 'email'} inputMode="email" placeholder="输入你的邮箱地址"
              value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
              aria-describedby={visibleState === 'error' || visibleState === 'unavailable' ? `${id}-feedback` : undefined} />
            {(visibleState === 'error' || visibleState === 'unavailable') && <p role="alert" id={`${id}-feedback`} className={styles.feedback}>
              {visibleState === 'unavailable' ? '光影来信正在准备中，暂时无法订阅。请稍后再来。' : '暂时未能完成订阅，请检查网络后重试。'}
            </p>}
            <button className={styles.submit} type="submit" disabled={busy || preview}>
              {busy ? <><span className={styles.spinner} />正在提交…</> : <>{visibleState === 'error' ? '重新提交' : style === 'ticket' ? '领取光影来信' : '订阅光影来信'}<span aria-hidden="true">→</span></>}
            </button>
            <p className={styles.privacy}>随时可以退订。</p>
            <button type="button" className={styles.secondary} onClick={close}>暂时不用</button>
          </form>}
        </div>
        {style === 'ticket' && <aside className={styles.ticketStub} aria-hidden="true">
          <strong className={styles.ticketMessage}>光影来信</strong><span className={styles.ticketRule} />
          <span className={styles.ticketBrand}>04320TV</span><span className={styles.ticketType}>为你留座</span>
          <div className={styles.ticketCoast} />
        </aside>}
      </div>
    </div>,
    document.body
  );
}
