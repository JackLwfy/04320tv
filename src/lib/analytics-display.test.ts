import { describe, expect, it } from 'vitest';
import { analyticsDate, analyticsRange, formatMetric } from './analytics-display';

describe('analytics display', () => {
  it('uses Beijing dates across UTC midnight and month boundaries', () => {
    const now = Date.parse('2026-02-28T16:00:00Z');
    expect(analyticsDate(now)).toBe('2026-03-01');
    expect(analyticsRange(7, false, now)).toEqual({ from: '2026-02-23', to: '2026-03-01' });
    expect(analyticsRange(1, true, now)).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });
  it('keeps missing data distinct from zero and formats backend units', () => {
    expect(formatMetric(null)).toBe('不可用');
    expect(formatMetric(0)).toBe('0');
    expect(formatMetric(98.5, 'percent')).toBe('98.5%');
    expect(formatMetric(3661000, 'duration')).toBe('1 小时 1 分');
    expect(formatMetric(1250, 'milliseconds')).toBe('1.25 秒');
    expect(formatMetric(Infinity)).toBe('不可用');
  });
});
