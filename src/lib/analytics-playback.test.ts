import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPlaybackAnalytics, markAnalyticsSourceSwitch, PlaybackClock } from './analytics-playback';
import { getPromotionAttribution, trackAnalytics } from './analytics-client';

vi.mock('./analytics-client', () => ({ analyticsId: () => crypto.randomUUID(), getAnalyticsAttribution: () => ({}), getPromotionAttribution: vi.fn(() => ({ promotionId: '', promotionVisitId: '' })), trackAnalytics: vi.fn(), flushAnalytics: vi.fn() }));

describe('playback cumulative clock', () => {
  it('counts wall time, separates hidden playback, excludes pause and seek', () => {
    let now = 0;
    const clock = new PlaybackClock(() => now);
    clock.set('playing'); now += 1000; clock.visibility(true); now += 500;
    clock.set('idle'); now += 3000;
    clock.set('seek'); now += 200;
    clock.set('playing'); now += 1000;
    clock.set('buffer'); now += 400; clock.set('buffer'); now += 100;
    expect(clock.snapshot()).toEqual({ sequence: 1, playedMs: 2500, hiddenPlayedMs: 1500, bufferMs: 500, bufferCount: 1, seekBufferMs: 200 });
    expect(clock.snapshot().sequence).toBe(2);
  });
});

describe('playback lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('performance', { now: () => Date.now() });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const meta = { media: 'vod' as const, sourceKey: 'test', vodId: '1', episode: 0 };
  function video() { return Object.assign(new EventTarget(), { currentTime: 0, duration: Infinity, paused: false, readyState: 4 }) as unknown as HTMLVideoElement; }
  it('StrictMode probe does not create a duplicate loading or abandoned attempt', () => {
    const v = video();
    attachPlaybackAnalytics(v, meta).dispose();
    const tracker = attachPlaybackAnalytics(v, meta);
    vi.advanceTimersByTime(1);
    expect(trackAnalytics).toHaveBeenCalledTimes(1);
    tracker.dispose();
    expect(trackAnalytics).toHaveBeenCalledTimes(2);
  });
  it('freezes promotion attribution for the attempt across source changes', () => {
    vi.mocked(getPromotionAttribution).mockReturnValue({ promotionId: 'A', promotionVisitId: 'visit-A' });
    const tracker = attachPlaybackAnalytics(video(), meta);
    vi.advanceTimersByTime(1);
    vi.mocked(getPromotionAttribution).mockReturnValue({ promotionId: 'B', promotionVisitId: 'visit-B' });
    vi.advanceTimersByTime(30_000);
    expect(vi.mocked(trackAnalytics).mock.calls.every(([event]) => event.promotionId === 'A' && event.promotionVisitId === 'visit-A')).toBe(true);
    tracker.dispose();
  });
  it('requires progressing playback for fallback first frame and preserves attempt on heartbeats', () => {
    const v = video(); const tracker = attachPlaybackAnalytics(v, meta);
    vi.advanceTimersByTime(1); v.dispatchEvent(new Event('playing'));
    expect(trackAnalytics).toHaveBeenCalledTimes(1);
    v.currentTime = 0.1; v.dispatchEvent(new Event('timeupdate'));
    vi.advanceTimersByTime(30000);
    const calls = vi.mocked(trackAnalytics).mock.calls.map(([e]) => e);
    expect(calls[1].firstFrameMethod).toBe('progress');
    expect(calls[2].playedMs).toBeGreaterThanOrEqual(29999);
    expect(calls[2].attemptId).toBe(calls[0].attemptId);
    expect(calls[2].sequence).toBeGreaterThan(calls[1].sequence!);
    tracker.dispose();
  });
  it('explicit same-episode switch links attempts and preserves watch, next episode starts a new watch', () => {
    const first = attachPlaybackAnalytics(video(), meta); vi.advanceTimersByTime(1);
    const initial = vi.mocked(trackAnalytics).mock.calls.at(-1)![0];
    markAnalyticsSourceSwitch(); first.dispose();
    const second = attachPlaybackAnalytics(video(), { ...meta, sourceKey: 'second' }); vi.advanceTimersByTime(1);
    const switched = vi.mocked(trackAnalytics).mock.calls.at(-1)![0];
    expect(switched.watchId).toBe(initial.watchId); expect(switched.previousAttemptId).toBe(initial.attemptId);
    second.dispose();
    const third = attachPlaybackAnalytics(video(), { ...meta, episode: 1 }); vi.advanceTimersByTime(1);
    expect(vi.mocked(trackAnalytics).mock.calls.at(-1)![0].watchId).not.toBe(initial.watchId);
    third.dispose();
  });
  it('distinguishes cancelled loading from timeout', () => {
    const cancelled = attachPlaybackAnalytics(video(), meta); vi.advanceTimersByTime(1); cancelled.dispose();
    expect(vi.mocked(trackAnalytics).mock.calls.at(-1)![0].playbackStatus).toBe('abandoned');
    const timed = attachPlaybackAnalytics(video(), meta); vi.advanceTimersByTime(45001);
    expect(vi.mocked(trackAnalytics).mock.calls.at(-1)![0].playbackStatus).toBe('timeout'); timed.dispose();
  });
  it('retains the failure code when a later pause snapshot is sent', () => {
    const v = video(); const tracker = attachPlaybackAnalytics(v, meta);
    vi.advanceTimersByTime(1); tracker.fail('network_error');
    v.dispatchEvent(new Event('pause'));
    expect(vi.mocked(trackAnalytics).mock.calls.at(-1)![0]).toMatchObject({ playbackStatus: 'error', errorCode: 'network_error' });
    tracker.dispose();
  });
  it('does not keep an idle paused player active with unchanged heartbeats', () => {
    const v = video(); const tracker = attachPlaybackAnalytics(v, meta);
    vi.advanceTimersByTime(1); v.currentTime = 1; v.dispatchEvent(new Event('timeupdate'));
    Object.assign(v, { paused: true }); v.dispatchEvent(new Event('pause'));
    const calls = vi.mocked(trackAnalytics).mock.calls.length;
    vi.advanceTimersByTime(40 * 60_000);
    expect(trackAnalytics).toHaveBeenCalledTimes(calls);
    Object.assign(v, { paused: false }); v.dispatchEvent(new Event('playing'));
    expect(trackAnalytics).toHaveBeenCalledTimes(calls + 1);
    tracker.dispose();
  });
  it('resumes after BFCache without counting time spent frozen as playback', () => {
    const v = video(); const tracker = attachPlaybackAnalytics(v, meta);
    vi.advanceTimersByTime(1); v.currentTime = 1; v.dispatchEvent(new Event('timeupdate'));
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    vi.advanceTimersByTime(10000);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    vi.advanceTimersByTime(1000); v.dispatchEvent(new Event('pause'));
    const last = vi.mocked(trackAnalytics).mock.calls.at(-1)![0];
    expect(last.playedMs).toBe(2000); expect(last.playbackStatus).toBe('playing');
    tracker.dispose();
  });
});
