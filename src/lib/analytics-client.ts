'use client';

import type { AnalyticsEventInput, AnalyticsSession } from './analytics-types';

type Pending = { event: AnalyticsEventInput; tries: number };
const KEY = '04320.analytics.queue.v1';
const SESSION = '04320.analytics.session.v1';
let queue: Pending[] = [];
let ready = false;
let allowed = false;
let session: AnalyticsSession | undefined;
let connecting: Promise<AnalyticsSession | undefined> | undefined;
let busy = false;
let nextTry = 0;
let lastActivity = 0;
let disabledUntil = 0;
let timer: ReturnType<typeof setInterval> | undefined;
export const analyticsId = () => crypto.randomUUID();

const PROMOTION = '04320.analytics.promotion.v1';
const PROMOTION_TTL = 30 * 60_000;
const PROMOTION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type PromotionVisit = { promotionId: string; promotionVisitId: string; enteredAt: number; activityAt: number; page: string };
let promotion: PromotionVisit | undefined;
let promotionLoaded = false;
let capturedRoute: string | undefined;
let capturedPromotionId: string | undefined;
function savePromotion() {
  try { if (promotion) sessionStorage.setItem(PROMOTION, JSON.stringify(promotion)); else sessionStorage.removeItem(PROMOTION); } catch { /* In-memory attribution still works. */ }
}
function loadPromotion() {
  if (promotionLoaded) return;
  promotionLoaded = true;
  try {
    const value = JSON.parse(sessionStorage.getItem(PROMOTION) || 'null');
    if (value && typeof value.promotionId === 'string' && PROMOTION_UUID.test(value.promotionId) && typeof value.promotionVisitId === 'string' && PROMOTION_UUID.test(value.promotionVisitId) && Number.isFinite(value.enteredAt) && Number.isFinite(value.activityAt) && value.enteredAt <= value.activityAt && value.activityAt <= Date.now() && typeof value.page === 'string' && ['/', '/watch', '/live', '/about'].includes(value.page)) promotion = value;
  } catch { /* Ignore malformed storage. */ }
}
/** Capture before authentication; deliver only after analytics is enabled. */
export function capturePromotionEntry(pathname: string, search: string, referrer = '') {
  if (pathname.startsWith('/admin')) return;
  loadPromotion();
  const route = pathname + '?' + search;
  if (capturedRoute === route) return;
  const firstRoute = capturedRoute === undefined;
  capturedRoute = route;
  const now = Date.now();
  const id = new URLSearchParams(search).get('promo')?.toLowerCase();
  const previousId = capturedPromotionId;
  capturedPromotionId = id;
  let external = false;
  try { external = !!referrer && new URL(referrer).origin !== location.origin; } catch { /* Direct visit. */ }
  const navigation = firstRoute && typeof performance !== 'undefined' ? performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined : undefined;
  if (promotion && now - promotion.activityAt > PROMOTION_TTL) { promotion = undefined; savePromotion(); }
  // Full new navigations count even when the channel hides referrers; reload and retained SPA parameters do not.
  if (id && PROMOTION_UUID.test(id) && (!firstRoute ? id !== previousId && id !== promotion?.promotionId : navigation?.type !== 'reload' && (!promotion || id !== promotion.promotionId || external || navigation?.type === 'navigate'))) {
    promotion = { promotionId: id, promotionVisitId: analyticsId(), enteredAt: now, activityAt: now, page: pathname };
    savePromotion();
    if (allowed) sendPromotionEntry();
  }
}
function sendPromotionEntry() {
  if (promotion && Date.now() - promotion.activityAt <= PROMOTION_TTL) void trackAnalytics({ type: 'promotion_entry', id: promotion.promotionVisitId, at: promotion.enteredAt, page: promotion.page, promotionId: promotion.promotionId, promotionVisitId: promotion.promotionVisitId });
}
export function getPromotionAttribution(): Pick<AnalyticsEventInput, 'promotionId' | 'promotionVisitId'> {
  loadPromotion();
  if (promotion && Date.now() - promotion.activityAt > PROMOTION_TTL) { promotion = undefined; savePromotion(); }
  // Empty fields also freeze an unattributed playback attempt.
  return { promotionId: promotion?.promotionId || '', promotionVisitId: promotion?.promotionVisitId || '' };
}

function persist() {
  try { sessionStorage.setItem(KEY, JSON.stringify(queue)); } catch { /* Storage may be unavailable. */ }
}
function restore() {
  if (ready) return;
  ready = true;
  try { queue = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { queue = []; }
  if (!Array.isArray(queue)) queue = [];
  prune();
}
function prune() {
  queue = queue.filter((p) => p?.event?.id && Date.now() - (p.event.at || 0) < 30 * 60_000 && p.tries < 8).slice(-200);
  persist();
}
export function analyticsBatch(items: AnalyticsEventInput[], token: string) {
  const events: AnalyticsEventInput[] = [];
  for (const event of items.slice(0, 20)) {
    if (new TextEncoder().encode(JSON.stringify({ token, events: [...events, event] })).length > 28_000) break;
    events.push(event);
  }
  return events;
}
async function getSession() {
  if (!allowed || Date.now() < disabledUntil) return undefined;
  if (session?.token && (session.expiresAt || 0) > Date.now() + 60_000) return session;
  if (!connecting) connecting = (async () => {
    let sessionId: string | undefined;
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
      if (saved && Date.now() - saved.at < 30 * 60_000) sessionId = saved.id;
    } catch { /* Ignore expired storage. */ }
    const response = await fetch('/api/analytics/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('session');
    if (!allowed) return undefined;
    session = await response.json() as AnalyticsSession;
    if (!session.enabled) { queue = []; persist(); disabledUntil = Date.now() + 60_000; }
    else if (session.sessionId) {
      // The session ID also deduplicates renewal/reload markers without adding another PV.
      queue.unshift({ event: { type: 'session_start', id: session.sessionId, at: Date.now(), page: location.pathname }, tries: 0 });
      persist();
      try { sessionStorage.setItem(SESSION, JSON.stringify({ id: session.sessionId, at: Date.now() })); } catch { /* Optional storage. */ }
    }
    return session;
  })().catch(() => undefined).finally(() => { connecting = undefined; });
  return connecting;
}
export function enableAnalytics(value: boolean) {
  allowed = value;
  if (value) {
    restore();
    sendPromotionEntry();
    if (!timer) timer = setInterval(() => { void flushAnalytics(); }, 4000);
  } else if (timer) { clearInterval(timer); timer = undefined; }
}
const sourceHashes = new Map<string, Promise<string>>();
async function privateSourceKey(value: string | undefined) {
  if (!value) return undefined;
  let hash = sourceHashes.get(value);
  if (!hash) {
    hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((bytes) => 'sha256:' + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join(''));
    if (sourceHashes.size >= 200) sourceHashes.clear();
    sourceHashes.set(value, hash);
  }
  return hash;
}
export async function privateAnalyticsEvent(event: AnalyticsEventInput): Promise<AnalyticsEventInput> {
  const clean = { ...event };
  for (const key of ['query', 'title', 'sourceName', 'vodId', 'referrer', 'campaign', 'recommendationId'] as const) {
    if (clean[key]) clean[key] = clean[key]!.replace(/https?:\/\/\S+/gi, '[链接]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱]').slice(0, key === 'title' ? 200 : 100);
  }
  clean.sourceKey = await privateSourceKey(event.sourceKey);
  if (event.outcomes) clean.outcomes = await Promise.all(event.outcomes.map(async (o) => ({ ...o, sourceKey: (await privateSourceKey(o.sourceKey))!, sourceName: o.sourceName.replace(/https?:\/\/\S+/gi, '[链接]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱]').slice(0, 96) })));
  return clean;
}
export async function trackAnalytics(event: AnalyticsEventInput, immediate = false) {
  if (!allowed || typeof window === 'undefined' || location.pathname.startsWith('/admin')) return;
  restore();
  if (lastActivity && Date.now() - lastActivity > 30 * 60_000) { session = undefined; try { sessionStorage.removeItem(SESSION); } catch { /* Optional storage. */ } }
  lastActivity = Date.now();
  if (session?.sessionId) try { sessionStorage.setItem(SESSION, JSON.stringify({ id: session.sessionId, at: lastActivity })); } catch { /* Optional storage. */ }
  const currentPromotion = getPromotionAttribution();
  const frozen = event.promotionId !== undefined ? {} : currentPromotion;
  if (promotion && event.type !== 'promotion_entry') { promotion.activityAt = Date.now(); savePromotion(); }
  const input = { ...frozen, ...event, id: event.id || analyticsId(), at: event.at || Date.now(), page: event.page || location.pathname };
  let cleaned: AnalyticsEventInput;
  try { cleaned = await privateAnalyticsEvent(input); } catch { return; }
  if (!allowed) return;
  queue.push({ event: cleaned, tries: 0 });
  prune();
  if (immediate) void flushAnalytics();
}
export async function flushAnalytics(beacon = false) {
  if (!allowed || busy || !queue.length || Date.now() < nextTry) return;
  busy = true;
  try {
    const auth = await getSession();
    if (!allowed || !auth?.enabled || !auth.token) return;
    const events = analyticsBatch(queue.map((p) => p.event), auth.token);
    if (!events.length) { queue.shift(); persist(); return; }
    const body = JSON.stringify({ token: auth.token, events });
    // Beacon has no acknowledgement: retain IDs so a later retry is safely deduplicated.
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/analytics/collect', new Blob([body], { type: 'application/json' })); return; }
    const ids = new Set(events.map((e) => e.id));
    const response = await fetch('/api/analytics/collect', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, signal: AbortSignal.timeout(8000) });
    if (response.ok || response.status === 400 || response.status === 413) queue = queue.filter((p) => !ids.has(p.event.id));
    else {
      if (response.status === 401) session = undefined;
      for (const p of queue) if (ids.has(p.event.id)) p.tries++;
      nextTry = Date.now() + (response.status === 429 ? 60_000 : 8000);
    }
    prune();
  } catch {
    queue.slice(0, 20).forEach((p) => p.tries++);
    nextTry = Date.now() + 15_000;
    prune();
  } finally { busy = false; }
}

let attribution: { searchId?: string; recommendationId?: string; at: number } = { at: 0 };
export function setAnalyticsAttribution(value: { searchId?: string; recommendationId?: string }) { attribution = { ...attribution, ...value, at: Date.now() }; }
export function getAnalyticsAttribution() { return Date.now() - attribution.at < 30 * 60_000 ? { searchId: attribution.searchId, recommendationId: attribution.recommendationId } : {}; }
