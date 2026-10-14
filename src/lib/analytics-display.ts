import type { MetricFormat } from './analytics-types';

export function analyticsDate(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function analyticsRange(days: number, yesterday = false, now = Date.now()) {
  const end = now - (yesterday ? 86400000 : 0);
  return { from: analyticsDate(end - (days - 1) * 86400000), to: analyticsDate(end) };
}
export function formatMetric(value: string | number | null, format: MetricFormat = 'number'): string {
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return '不可用';
  if (typeof value === 'string' || format === 'text') return String(value);
  if (format === 'percent') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
  if (format === 'milliseconds') return value >= 1000 ? `${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 秒` : `${Math.round(value)} ms`;
  if (format === 'duration') {
    const seconds = Math.max(0, Math.floor(value / 1000));
    return seconds >= 3600 ? `${Math.floor(seconds / 3600).toLocaleString('zh-CN')} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  }
  if (format === 'bytes') return value >= 1073741824 ? `${(value / 1073741824).toFixed(2)} GB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
