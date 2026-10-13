'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NewsletterDialog } from './newsletter-dialog';
import { siteSettings } from '@/lib/site-settings';
import { canPromptNewsletter, NEWSLETTER_DISMISSED_KEY, newsletterDay } from '@/lib/newsletter-prompt';
import { useAuth } from './auth';

export function NewsletterEntry() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { checked, verified } = useAuth();
  const interacted = useRef(false);
  const rememberToday = useCallback(() => {
    interacted.current = true;
    try { localStorage.setItem(NEWSLETTER_DISMISSED_KEY, newsletterDay()); } catch { /* 本次页面仍不重复弹出。 */ }
  }, []);
  const close = useCallback(() => { rememberToday(); setOpen(false); }, [rememberToday]);

  useEffect(() => {
    if (!siteSettings.newsletterEnabled || pathname !== '/' || !checked || !verified || open || interacted.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      try { if (!canPromptNewsletter(localStorage) || interacted.current) return; } catch { return; }
      // 等页面可见且其他弹窗关闭后再提示，避免盖住登录或观影操作。
      if (document.visibilityState !== 'visible' || document.querySelector('[role="dialog"], dialog[open]') || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) {
        timer = setTimeout(show, 1000);
        return;
      }
      interacted.current = true;
      setOpen(true);
    };
    timer = setTimeout(show, 3000);
    return () => clearTimeout(timer);
  }, [pathname, checked, verified, open]);

  if (!siteSettings.newsletterEnabled) return null;
  return <><button type="button" onClick={() => { interacted.current = true; setOpen(true); }}>订阅光影来信</button>{open && <NewsletterDialog style={siteSettings.newsletterStyle} onClose={close} onAccepted={rememberToday} />}</>;
}
