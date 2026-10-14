import { describe, expect, it } from 'vitest';
import { config, middleware } from '../../middleware.js';

function forwarded(geo?: Record<string, string>, clientIp?: string) {
  const headers = new Headers({
    'x-04320-geo-country': 'US',
    'x-04320-geo-region': 'forged',
    'x-04320-geo-code': 'fake',
    'eo-connecting-ip': '198.51.100.99',
  });
  return middleware({
    geo, clientIp,
    next({ headers: overrides }: { headers: Record<string, string> }) {
      for (const [name, value] of Object.entries(overrides)) headers.set(name, value);
      return headers;
    },
  });
}

describe('EdgeOne analytics middleware', () => {
  it('overwrites forged location and IP headers with platform context', () => {
    const headers = forwarded({ countryCodeAlpha2: 'CN', regionName: '广东省', regionCode: '44' }, '203.0.113.7');
    expect(headers.get('x-04320-geo-country')).toBe('CN');
    expect(headers.get('x-04320-geo-region')).toBe(encodeURIComponent('广东省'));
    expect(headers.get('x-04320-geo-code')).toBe('44');
    expect(headers.get('eo-connecting-ip')).toBe('203.0.113.7');
  });

  it('clears all untrusted values when platform location and IP are unavailable', () => {
    const headers = forwarded();
    for (const name of ['x-04320-geo-country', 'x-04320-geo-region', 'x-04320-geo-code', 'eo-connecting-ip']) {
      expect(headers.get(name)).toBe('');
    }
  });

  it('clears missing province fields instead of retaining forged browser values', () => {
    const headers = forwarded({ countryCodeAlpha2: 'CN' }, '2001:db8::7');
    expect(headers.get('x-04320-geo-country')).toBe('CN');
    expect(headers.get('x-04320-geo-region')).toBe('');
    expect(headers.get('x-04320-geo-code')).toBe('');
    expect(headers.get('eo-connecting-ip')).toBe('2001:db8::7');
  });

  it('runs only on the analytics session and collect routes', () => {
    expect(config.matcher).toEqual(['/api/analytics/collect', '/api/analytics/session']);
    expect(config.matcher).not.toContain('/api/admin/analytics');
    expect(config.matcher).not.toContain('/');
  });
});
