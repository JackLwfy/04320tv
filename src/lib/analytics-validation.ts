import crypto from 'node:crypto';
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventInput, type AnalyticsSourceOutcome } from './analytics-types';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const DAY_MS = 86400000;
export function text(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max * 4) throw new Error('文本字段过长。');
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}
export function privateText(value: unknown, max: number): string {
  return text(value, max).replace(/https?:\/\/\S+/gi, '[链接]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱]');
}
function number(value: unknown, max: number, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('数值超出范围。');
  return Math.floor(value);
}
function uuid(value: unknown, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('统计标识无效。');
  return value.toLowerCase();
}
function choice<T extends string>(value: unknown, options: readonly T[], fallback?: T): T | undefined {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error('统计选项无效。');
  return value as T;
}
export function sourceHash(value: unknown): string {
  const key = text(value, 2048);
  if (/^sha256:[a-f0-9]{64}$/.test(key)) return key.slice(7);
  return key ? crypto.createHash('sha256').update(key).digest('hex') : '';
}
function errorCode(value: unknown): string {
  const code = text(value, 64);
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(code) ? code : code ? 'OTHER' : '';
}
export function clientDimensions(userAgent: string) {
  return {
    device: /ipad|tablet|android(?!.*mobile)/i.test(userAgent) ? 'tablet' : /mobile|iphone|ipod/i.test(userAgent) ? 'mobile' : 'desktop',
    browser: /edg\//i.test(userAgent) ? 'Edge' : /firefox|fxios/i.test(userAgent) ? 'Firefox' : /chrome|crios/i.test(userAgent) ? 'Chrome' : /safari/i.test(userAgent) ? 'Safari' : 'Other',
  };
}
export type ValidEvent = AnalyticsEventInput & { id: string; at: number; sourceKey: string };

export function validateEvents(input: unknown, now = Date.now()): ValidEvent[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new Error('每批统计事件应为 1 至 20 条。');
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('统计事件格式无效。');
    const type = choice(raw.type, ANALYTICS_EVENT_TYPES);
    if (!type) throw new Error('统计事件类型无效。');
    const at = number(raw.at, now + 60000);
    if (at < now - DAY_MS) throw new Error('统计事件已过期。');
    const event: ValidEvent = {
      type, id: uuid(raw.id, true)!, at: Math.min(at, now),
      promotionId: raw.promotionId ? uuid(raw.promotionId) : undefined, promotionVisitId: raw.promotionVisitId ? uuid(raw.promotionVisitId) : undefined,
      media: choice(raw.media, ['vod', 'live']),
      sourceKey: sourceHash(raw.sourceKey), sourceName: privateText(raw.sourceName, 96),
      sourceOrigin: choice(raw.sourceOrigin, ['site', 'custom'], 'custom'),
      vodId: privateText(raw.vodId, 100), title: privateText(raw.title, 200),
      episode: raw.episode === undefined ? undefined : number(raw.episode, 100000),
      searchId: uuid(raw.searchId), query: privateText(raw.query, 100),
      searchStatus: choice(raw.searchStatus, ['success', 'empty', 'partial', 'error', 'cancelled']),
      resultCount: number(raw.resultCount, 1000000), durationMs: number(raw.durationMs, 600000),
      page: choice(raw.page, ['/', '/watch', '/live', '/about'], '/'),
      referrer: '', campaign: privateText(raw.campaign, 80),
      errorCode: errorCode(raw.errorCode), recommendationId: privateText(raw.recommendationId, 100),
    };
    if (type === 'promotion_entry' && (!event.promotionId || !event.promotionVisitId || event.id !== event.promotionVisitId)) throw new Error('推广入口标识缺失。');
    if (raw.referrer) {
      try {
        const value = text(raw.referrer, 2048);
        event.referrer = new URL(value.includes('://') ? value : `https://${value}`).hostname.slice(0, 180);
      }
      catch { event.referrer = ''; }
    }
    if (type === 'search') {
      if (!event.searchId || !event.searchStatus) throw new Error('搜索事件缺少标识或状态。');
      if (raw.outcomes !== undefined && (!Array.isArray(raw.outcomes) || raw.outcomes.length > 50)) throw new Error('搜索片源结果过多。');
      const seen = new Set<string>();
      event.outcomes = (raw.outcomes || []).map((item: AnalyticsSourceOutcome) => {
        if (!item || typeof item !== 'object') throw new Error('片源结果无效。');
        const sourceKey = sourceHash(item.sourceKey);
        if (!sourceKey || seen.has(sourceKey)) throw new Error('重复或缺失片源标识。');
        seen.add(sourceKey);
        const status = choice(item.status, ['success', 'empty', 'error', 'timeout']);
        if (!status) throw new Error('片源结果状态缺失。');
        return { sourceKey, sourceName: privateText(item.sourceName, 96), sourceOrigin: choice(item.sourceOrigin, ['site', 'custom'], 'custom')!, status, durationMs: number(item.durationMs, 600000), resultCount: number(item.resultCount, 1000000), errorCode: errorCode(item.errorCode) };
      });
    }
    if (type === 'playback') {
      const startedAt = number(raw.startedAt, event.at);
      if (startedAt < event.at - DAY_MS || !event.media || !event.sourceKey) throw new Error('播放事件缺少来源或开始时间。');
      const elapsed = event.at - startedAt + 1500;
      const playedMs = number(raw.playedMs, elapsed);
      const hiddenPlayedMs = number(raw.hiddenPlayedMs, playedMs);
      const bufferMs = number(raw.bufferMs, elapsed);
      const seekBufferMs = number(raw.seekBufferMs, elapsed);
      if (playedMs + bufferMs + seekBufferMs > elapsed + 1500) throw new Error('播放累计时间异常。');
      const status = choice(raw.playbackStatus, ['loading', 'playing', 'ended', 'error', 'abandoned', 'timeout']);
      if (!status) throw new Error('播放状态缺失。');
      Object.assign(event, {
        startedAt, watchId: uuid(raw.watchId, true), attemptId: uuid(raw.attemptId, true),
        sequence: number(raw.sequence, 1000000), playbackStatus: status,
        playedMs, hiddenPlayedMs, bufferMs, bufferCount: number(raw.bufferCount, 100000), seekBufferMs,
        firstFrameMs: raw.firstFrameMs === undefined ? undefined : number(raw.firstFrameMs, Math.min(elapsed, 600000)),
        firstFrameMethod: choice(raw.firstFrameMethod, ['frame', 'progress']),
        positionMs: number(raw.positionMs, 7 * DAY_MS), mediaDurationMs: number(raw.mediaDurationMs, 7 * DAY_MS),
        previousAttemptId: uuid(raw.previousAttemptId), switchReason: choice(raw.switchReason, ['manual', 'error', 'auto']),
      });
      if (event.firstFrameMs !== undefined && !event.firstFrameMethod) throw new Error('首帧测量方式缺失。');
    }
    return event;
  });
}

export function sqlDate(ms: number): string { return new Date(ms).toISOString().slice(0, 23).replace('T', ' '); }
export function businessDay(ms = Date.now()): string { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); }
