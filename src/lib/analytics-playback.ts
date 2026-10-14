'use client';

import type { AnalyticsEventInput, PlaybackStatus } from './analytics-types';
import { analyticsId, getAnalyticsAttribution, trackAnalytics, flushAnalytics } from './analytics-client';

export type PlaybackMetadata = Pick<AnalyticsEventInput, 'media' | 'sourceKey' | 'sourceName' | 'sourceOrigin' | 'vodId' | 'title' | 'episode'>;
type Mode = 'idle' | 'playing' | 'buffer' | 'seek';

/** Wall-clock accumulation: seeking and playbackRate never inflate watched time. */
export class PlaybackClock {
  playedMs = 0;
  hiddenPlayedMs = 0;
  bufferMs = 0;
  bufferCount = 0;
  seekBufferMs = 0;
  sequence = 0;
  private mode: Mode = 'idle';
  private hidden = false;
  private last: number;
  constructor(private now: () => number = () => performance.now()) { this.last = now(); }
  tick() {
    const now = this.now();
    const delta = Math.max(0, now - this.last);
    this.last = now;
    if (this.mode === 'playing') { this.playedMs += delta; if (this.hidden) this.hiddenPlayedMs += delta; }
    if (this.mode === 'buffer') this.bufferMs += delta;
    if (this.mode === 'seek') this.seekBufferMs += delta;
  }
  set(mode: Mode, hidden = this.hidden) {
    this.tick();
    if (mode === 'buffer' && this.mode !== 'buffer') this.bufferCount++;
    this.mode = mode; this.hidden = hidden;
  }
  visibility(hidden: boolean) { this.tick(); this.hidden = hidden; }
  snapshot() {
    this.tick();
    return { sequence: ++this.sequence, playedMs: Math.round(this.playedMs), hiddenPlayedMs: Math.round(this.hiddenPlayedMs), bufferMs: Math.round(this.bufferMs), bufferCount: this.bufferCount, seekBufferMs: Math.round(this.seekBufferMs) };
  }
}

let active: { watchId: string; attemptId: string; episode?: number; media?: string; failed?: boolean } | undefined;
let pendingSwitch: { watchId: string; previousAttemptId: string; episode?: number; reason: 'manual' | 'error' | 'auto'; target?: { sourceKey: string; vodId: string }; at: number } | undefined;
export function markAnalyticsSourceSwitch(reason: 'manual' | 'error' | 'auto' = 'manual', target?: { sourceKey: string; vodId: string }) {
  if (active) pendingSwitch = { watchId: active.watchId, previousAttemptId: active.attemptId, episode: active.episode, reason: active.failed ? 'error' : reason, target, at: Date.now() };
}

export function attachPlaybackAnalytics(video: HTMLVideoElement, metadata: PlaybackMetadata) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let disposed = false;
  let started = false;
  let terminal = false;
  let earlyError: string | undefined;
  let lastError: string | undefined;
  let firstFrameMs: number | undefined;
  let firstFrameMethod: 'frame' | 'progress' | undefined;
  let status: PlaybackStatus = 'loading';
  let seeking = false;
  const startedAt = Date.now();
  const startMono = performance.now();
  const clock = new PlaybackClock();
  const attemptId = analyticsId();
  const previous = pendingSwitch && Date.now() - pendingSwitch.at < 60_000 && pendingSwitch.episode === metadata.episode && (!pendingSwitch.target || (pendingSwitch.target.sourceKey === metadata.sourceKey && pendingSwitch.target.vodId === metadata.vodId)) ? pendingSwitch : undefined;
  const watchId = previous?.watchId || analyticsId();
  const base: AnalyticsEventInput = { type: 'playback', ...metadata, ...getAnalyticsAttribution(), attemptId, watchId, startedAt, previousAttemptId: previous?.previousAttemptId, switchReason: previous?.reason };
  const snapshot = (immediate = false, errorCode?: string) => {
    if (!started) return;
    trackAnalytics({ ...base, ...clock.snapshot(), playbackStatus: status, firstFrameMs, firstFrameMethod, positionMs: Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : 0, mediaDurationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined, errorCode: errorCode || lastError }, immediate);
  };
  const end = (state: PlaybackStatus, errorCode?: string) => {
    if (!started || terminal) return;
    terminal = true; status = state; clock.set('idle');
    lastError = errorCode;
    if (active?.attemptId === attemptId && (state === 'error' || state === 'timeout')) active.failed = true;
    snapshot(true, errorCode);
  };
  const first = (method: 'frame' | 'progress') => {
    if (disposed || firstFrameMs !== undefined || status === 'ended' || status === 'abandoned') return;
    terminal = false;
    lastError = undefined;
    firstFrameMs = Math.max(0, Math.round(performance.now() - startMono));
    firstFrameMethod = method; status = 'playing';
    clearTimeout(timeout);
    if (!video.paused && !seeking) clock.set('playing', document.hidden);
    snapshot(true);
  };
  const supportsFrames = typeof video.requestVideoFrameCallback === 'function';
  let previousPosition = video.currentTime;
  const listeners: [string, () => void][] = [
    ['playing', () => { if (firstFrameMs !== undefined && !terminal) { clock.set('playing', document.hidden); snapshot(true); } }],
    ['timeupdate', () => { if (!supportsFrames && !video.paused && !seeking && video.currentTime > previousPosition) first('progress'); previousPosition = video.currentTime; }],
    ['waiting', () => { if (firstFrameMs !== undefined && !video.paused && !terminal) clock.set(seeking ? 'seek' : 'buffer'); }],
    ['pause', () => { clock.set('idle'); snapshot(true); }],
    ['seeking', () => { seeking = true; clock.set('seek'); }],
    ['seeked', () => { seeking = false; previousPosition = video.currentTime; clock.set(!video.paused && video.readyState >= 3 && firstFrameMs !== undefined ? 'playing' : 'idle', document.hidden); }],
    ['ended', () => end('ended')],
  ];
  const visibility = () => { clock.visibility(document.hidden); snapshot(); if (document.hidden) void flushAnalytics(true); };
  const pagehide = (event: PageTransitionEvent) => {
    if (event.persisted) { clock.set('idle'); snapshot(); }
    else end('abandoned');
    void flushAnalytics(true);
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (!event.persisted || terminal) return;
    clock.set(!video.paused && firstFrameMs !== undefined ? 'playing' : 'idle', document.hidden);
    snapshot(true);
  };
  // Defer side effects: React StrictMode's setup/cleanup probe must not count as a play attempt.
  const startTimer = setTimeout(() => {
    if (disposed) return;
    started = true;
    pendingSwitch = undefined;
    active = { watchId, attemptId, episode: metadata.episode, media: metadata.media };
    listeners.forEach(([name, listener]) => video.addEventListener(name, listener));
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    snapshot();
    if (supportsFrames) frame = video.requestVideoFrameCallback(() => first('frame'));
    timeout = setTimeout(() => end('timeout', 'startup_timeout'), 45_000);
    interval = setInterval(() => { if (!terminal && !video.paused) snapshot(); }, 30_000);
    if (earlyError) end(earlyError === 'startup_timeout' ? 'timeout' : 'error', earlyError);
  }, 0);
  return {
    fail: (code = 'playback_error') => { if (!started) earlyError = code; else end(code === 'startup_timeout' ? 'timeout' : 'error', code); },
    dispose: () => {
      disposed = true;
      clearTimeout(startTimer); clearTimeout(timeout); clearInterval(interval);
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      end('abandoned');
      listeners.forEach(([name, listener]) => video.removeEventListener(name, listener));
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      void flushAnalytics(true);
    },
  };
}
