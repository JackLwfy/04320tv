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
});
