import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('analytics delivery queue', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
    vi.stubGlobal('window', {}); vi.stubGlobal('location', { pathname: '/' });
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('retries identical event IDs and removes only acknowledged events', async () => {
    const batches: { events: { id: string }[] }[] = [];
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('session')) return new Response(JSON.stringify({ enabled: true, token: 'token', sessionId: crypto.randomUUID(), expiresAt: Date.now() + 86400000 }));
      batches.push(JSON.parse(init.body as string));
      if (fail) { fail = false; return new Response('', { status: 503 }); }
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }));
    }));
    const c = await import('./analytics-client'); c.enableAnalytics(true);
    await c.trackAnalytics({ type: 'page_view' }); await c.flushAnalytics();
    expect(batches).toHaveLength(1);
    vi.setSystemTime(Date.now() + 9000); await c.flushAnalytics();
    expect(batches[1].events[0].id).toBe(batches[0].events[0].id);
    await c.flushAnalytics(); expect(batches).toHaveLength(2); c.enableAnalytics(false);
  });
  it('refreshes authorization after 401 and drops invalid batches', async () => {
    let sessions = 0; let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('session')) { sessions++; return new Response(JSON.stringify({ enabled: true, token: 't', expiresAt: Date.now() + 86400000 })); }
      calls++; return new Response('', { status: calls === 1 ? 401 : 400 });
    }));
    const c = await import('./analytics-client'); c.enableAnalytics(true); await c.trackAnalytics({ type: 'page_view' });
    await c.flushAnalytics(); vi.setSystemTime(Date.now() + 9000); await c.flushAnalytics(); await c.flushAnalytics();
    expect(sessions).toBe(2); expect(calls).toBe(2); c.enableAnalytics(false);
  });
  it('redacts sensitive strings and hashes source identifiers before persistence', async () => {
    const c = await import('./analytics-client');
    const event = await c.privateAnalyticsEvent({ type: 'search', sourceKey: 'sub_https://example.com?token=secret', query: 'a@example.com https://example.com?secret=1' });
    expect(event.sourceKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(event.query).toBe('[邮箱] [链接]');
  });
  it('caps count and encoded payload bytes and excludes admin visits', async () => {
    const c = await import('./analytics-client');
    expect(c.analyticsBatch(Array.from({ length: 30 }, () => ({ type: 'page_view' as const })), 't')).toHaveLength(20);
    const batch = c.analyticsBatch(Array.from({ length: 20 }, () => ({ type: 'search' as const, query: '中'.repeat(1000) })), 't');
    expect(new TextEncoder().encode(JSON.stringify({ token: 't', events: batch })).length).toBeLessThanOrEqual(28000);
    vi.stubGlobal('location', { pathname: '/admin' }); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    c.enableAnalytics(true); await c.trackAnalytics({ type: 'page_view' }); await c.flushAnalytics(); expect(fetch).not.toHaveBeenCalled(); c.enableAnalytics(false);
  });
  it('captures before auth, retains refresh identity, switches A to B and expires inactivity', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://site.test' });
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'navigate' }] });
    let c = await import('./analytics-client');
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    c.capturePromotionEntry('/', 'promo=' + a);
    const first = c.getPromotionAttribution();
    expect(first.promotionId).toBe(a);
    expect(sessionStorage.getItem('04320.analytics.queue.v1')).toBeNull();
    c.enableAnalytics(true);
    await c.trackAnalytics({ type: 'page_view' });
    const queue = JSON.parse(sessionStorage.getItem('04320.analytics.queue.v1')!);
    expect(queue[0].event).toMatchObject({ type: 'promotion_entry', id: first.promotionVisitId });
    expect(queue[1].event.promotionId).toBe(a);
    c.enableAnalytics(false);
    vi.resetModules(); c = await import('./analytics-client');
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'reload' }] });
    c.capturePromotionEntry('/', 'promo=' + a, 'https://outside.test/');
    expect(c.getPromotionAttribution()).toEqual(first);
    c.capturePromotionEntry('/watch', 'promo=' + a);
    expect(c.getPromotionAttribution()).toEqual(first);
    c.capturePromotionEntry('/', 'promo=' + b);
    expect(c.getPromotionAttribution().promotionId).toBe(b);
    vi.setSystemTime(Date.now() + 30 * 60_000 + 1);
    c.capturePromotionEntry('/watch', 'promo=' + b);
    expect(c.getPromotionAttribution().promotionId).toBe('');
  });
  it('does not revive expired attribution when an old frozen playback sends a snapshot', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://site.test' });
    const c = await import('./analytics-client');
    c.capturePromotionEntry('/', 'promo=' + crypto.randomUUID());
    const frozen = c.getPromotionAttribution(); c.enableAnalytics(true);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await c.trackAnalytics({ type: 'playback', ...frozen });
    await c.trackAnalytics({ type: 'page_view' });
    const queue = JSON.parse(sessionStorage.getItem('04320.analytics.queue.v1')!);
    expect(queue.at(-2).event.promotionId).toBe(frozen.promotionId);
    expect(queue.at(-1).event.promotionId).toBe('');
    c.enableAnalytics(false);
  });
  it('counts a new navigation to the same link even when the channel strips referrers', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://site.test' });
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'navigate' }] });
    let c = await import('./analytics-client'); const id = crypto.randomUUID();
    c.capturePromotionEntry('/', 'promo=' + id);
    const first = c.getPromotionAttribution();
    vi.resetModules(); c = await import('./analytics-client');
    c.capturePromotionEntry('/', 'promo=' + id);
    expect(c.getPromotionAttribution().promotionId).toBe(id);
    expect(c.getPromotionAttribution().promotionVisitId).not.toBe(first.promotionVisitId);
  });
  it('preserves mixed-case short codes across refresh and treats different case as a different link', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://site.test' });
    let c = await import('./analytics-client');
    c.capturePromotionEntry('/', 'promo=AbC_-123');
    const original = c.getPromotionAttribution();
    expect(original.promotionId).toBe('AbC_-123');
    vi.resetModules(); c = await import('./analytics-client');
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'reload' }] });
    c.capturePromotionEntry('/', 'promo=AbC_-123');
    expect(c.getPromotionAttribution()).toEqual(original);
    c.capturePromotionEntry('/watch', 'promo=abc_-123');
    expect(c.getPromotionAttribution().promotionId).toBe('abc_-123');
    expect(c.getPromotionAttribution().promotionVisitId).not.toBe(original.promotionVisitId);
  });
  it('ignores corrupt storage and keeps attribution when storage throws', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://site.test' });
    vi.stubGlobal('sessionStorage', { getItem: () => '{"promotionId":42}', setItem: () => { throw new Error('blocked'); }, removeItem: () => {} });
    const c = await import('./analytics-client');
    expect(c.getPromotionAttribution().promotionId).toBe('');
    const id = crypto.randomUUID(); c.capturePromotionEntry('/', 'promo=' + id);
    expect(c.getPromotionAttribution().promotionId).toBe(id);
  });

});
