'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from './auth';
import { enableAnalytics, flushAnalytics, trackAnalytics } from '@/lib/analytics-client';

export function AnalyticsTracker() {
  const { checked, verified } = useAuth();
  const pathname = usePathname();
  const search = useSearchParams();
  const route = pathname + '?' + search.toString();
  const last = useRef('');
  useEffect(() => {
    enableAnalytics(checked && verified);
    if (!checked || !verified) return;
    const hide = () => { if (document.visibilityState === 'hidden') void flushAnalytics(true); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); enableAnalytics(false); };
  }, [checked, verified]);
  useEffect(() => {
    if (!checked || !verified || last.current === route) return;
    last.current = route;
    let referrer = '';
    try { referrer = new URL(document.referrer).hostname; } catch { /* Direct visit. */ }
    trackAnalytics({ type: 'page_view', page: pathname, referrer, campaign: new URLSearchParams(location.search).get('utm_source')?.slice(0, 100) });
  }, [checked, verified, pathname, route]);
  return null;
}
