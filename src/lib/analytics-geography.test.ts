import { describe, expect, it, vi, afterEach } from 'vitest';
import { analyticsNetwork, geographyReport, networkCity, normalizeProvince, operatorForAsn, PROVINCES } from './analytics-geography';
import { parseReportFilter } from './analytics-report';

afterEach(() => vi.unstubAllEnvs());
describe('server IP and province attribution', () => {
  it('labels known carrier ASNs, keeps unmapped AS numbers explicit and bounds city text', () => {
    expect(operatorForAsn(4134)).toBe('中国电信');
    expect(operatorForAsn(4837)).toBe('中国联通');
    expect(operatorForAsn(9808)).toBe('中国移动');
    expect(operatorForAsn(4294900000)).toBe('AS4294900000');
    expect(operatorForAsn(0)).toBe('未知');
    expect(networkCity(' Chengdu\n\u0000 ')).toBe('Chengdu');
    expect(networkCity('城'.repeat(97))).toHaveLength(96);
    expect(networkCity({ city: 'forged' })).toBe('');
  });
  it('accepts only real province codes for traffic drill-down', () => {
    expect(parseReportFilter(new URL('https://example.test?view=traffic&province=51')).province).toBe('51');
    for (const query of ['view=traffic&province=510000', 'view=traffic&province=99', 'view=traffic&province=51%27', 'view=overview&province=51']) expect(() => parseReportFilter(new URL(`https://example.test?${query}`))).toThrow('省份筛选无效');
  });
  it.each([
    ['CN', '广东省', '', '44'], ['CN', 'Zhejiang', '', '33'], ['CN', 'Inner Mongolia', '', '15'],
    ['CN', '广西壮族自治区', '', '45'], ['CN', 'Tibet', '', '54'], ['CN', 'Shaanxi', '', '61'],
    ['CN', 'Shanxi', '', '14'], ['CN', 'Xinjiang Autonomous Region', '', '65'], ['CN', '', 'CN-11', '11'],
    ['HK', '', '', '81'], ['MO', '', '', '82'], ['TW', '', '', '71'],
    ['US', 'Georgia', '', ''], ['CN', '', '44', ''], ['CN', 'unknown', 'CN-99', ''],
  ])('maps %s %s %s to %s', (country, region, code, expected) => expect(normalizeProvince(country, region, code)).toBe(expected));
  it('canonicalizes IPv6 and mapped IPv4, ignores forwarded/client IP claims', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const read = (ip: string) => analyticsNetwork(new Headers({ 'eo-connecting-ip': ip, 'x-forwarded-for': '1.2.3.4', 'x-04320-geo-country': 'CN', 'x-04320-geo-region': encodeURIComponent('广东省') }));
    expect(read('2001:0db8:0:0:0:0:0:1')).toEqual({ ip: '2001:db8::1', country: 'CN', province: '44' });
    expect(read('::ffff:192.0.2.1').ip).toBe('192.0.2.1');
    for (const ip of ['', '1.2.3.4,5.6.7.8', 'fe80::1%eth0', 'invalid']) expect(read(ip).ip).toBe('');
    expect(analyticsNetwork(new Headers({ 'eo-connecting-ip': '192.0.2.1', 'x-04320-geo-country': 'CN', 'x-04320-geo-region': '%invalid' })).province).toBe('');
  });
  it('has all 34 provinces and keeps distinct totals separate from regional sums', () => {
    expect(PROVINCES).toHaveLength(34);
    const total = { views: 4, visitors: 1, ips: 1, sessions: 1 };
    const result = geographyReport([
      { region: '44', views: 1, visitors: 1, ips: 1, sessions: 1 },
      { region: '33', views: 1, visitors: 1, ips: 1, sessions: 1 },
      { region: 'overseas', views: 1, visitors: 1, ips: 1, sessions: 1 },
      { region: 'unknown', views: 1, visitors: 1, ips: 0, sessions: 1 },
    ], total, null);
    expect(result.total).toEqual(total);
    expect(result.provinces.find(p => p.code === '11')?.views).toBe(0);
    expect(result.unknown.views).toBe(1); expect(result.overseas.views).toBe(1);
    expect(result.unlocated.views).toBe(0);
  });
});
