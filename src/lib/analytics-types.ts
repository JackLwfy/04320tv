export const ANALYTICS_EVENT_TYPES = ['promotion_entry', 'session_start', 'page_view', 'detail_view', 'search', 'search_click', 'recommendation_impression', 'recommendation_click', 'playback', 'newsletter_impression', 'newsletter_close', 'newsletter_submit', 'newsletter_accepted', 'newsletter_error'] as const;
export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];
export type MediaKind = 'vod' | 'live';
export type PlaybackStatus = 'loading' | 'playing' | 'ended' | 'error' | 'abandoned' | 'timeout';
export interface AnalyticsSourceOutcome {
  sourceKey: string; sourceName: string; sourceOrigin?: 'site' | 'custom';
  status: 'success' | 'empty' | 'error' | 'timeout'; durationMs: number; resultCount: number; errorCode?: string;
}
export interface AnalyticsEventInput {
  type: AnalyticsEventType;
  id?: string; at?: number;
  page?: string; referrer?: string; campaign?: string;
  promotionId?: string; promotionVisitId?: string;
  media?: MediaKind; sourceKey?: string; sourceName?: string; sourceOrigin?: 'site' | 'custom';
  vodId?: string; title?: string; episode?: number;
  searchId?: string; query?: string; searchStatus?: 'success' | 'empty' | 'partial' | 'error' | 'cancelled';
  resultCount?: number; durationMs?: number; outcomes?: AnalyticsSourceOutcome[];
  watchId?: string; attemptId?: string; startedAt?: number; sequence?: number;
  playbackStatus?: PlaybackStatus; playedMs?: number; hiddenPlayedMs?: number;
  bufferMs?: number; bufferCount?: number; seekBufferMs?: number;
  firstFrameMs?: number; firstFrameMethod?: 'frame' | 'progress';
  positionMs?: number; mediaDurationMs?: number; errorCode?: string;
  switchReason?: 'manual' | 'error' | 'auto'; previousAttemptId?: string;
  recommendationId?: string;
}
export interface AnalyticsSession {
  enabled: boolean; token?: string; sessionId?: string; expiresAt?: number;
}
export type AnalyticsView = 'overview' | 'traffic' | 'search' | 'content' | 'quality' | 'newsletter' | 'health';
export type MetricFormat = 'number' | 'percent' | 'milliseconds' | 'duration' | 'text' | 'bytes';
export interface AnalyticsCard { key: string; label: string; value: number | null; format: MetricFormat; help: string; previous?: number | null }
export interface AnalyticsColumn { key: string; label: string; format?: MetricFormat }
export interface AnalyticsTable {
  key: string; title: string; help?: string; columns: AnalyticsColumn[];
  rows: Record<string, string | number | null>[]; total: number; page: number; pageSize: number;
}
export interface AnalyticsTrend {
  date: string; views: number; visitors: number; searches: number; starts: number; watchMs: number; failures: number;
}
export interface AnalyticsReport {
  view: AnalyticsView; from: string; to: string; generatedAt: string; timezone: 'Asia/Shanghai';
  enabled: boolean; lastEventAt: string | null; cards: AnalyticsCard[];
  trend: AnalyticsTrend[]; tables: AnalyticsTable[]; notices: string[];
  sources: { key: string; name: string }[];
  geography?: AnalyticsGeography;
  province?: string;
}

export interface AnalyticsGeoMetrics { views: number; visitors: number; ips: number; sessions: number }
export interface AnalyticsGeography {
  provinces: (AnalyticsGeoMetrics & { code: string; name: string })[];
  unknown: AnalyticsGeoMetrics; overseas: AnalyticsGeoMetrics; unlocated: AnalyticsGeoMetrics;
  total: AnalyticsGeoMetrics; startedAt: string | null;
}
