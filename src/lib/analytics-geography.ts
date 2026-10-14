import { isIP } from 'node:net';
import crypto from 'node:crypto';
import operators from './analytics-operators.json';
import type { AnalyticsGeography, AnalyticsGeoMetrics } from './analytics-types';

// GB/T 2260 province-level codes, also used by the bundled map.
export const PROVINCES = [
  ['11', '北京', 'Beijing'], ['12', '天津', 'Tianjin'], ['13', '河北', 'Hebei'], ['14', '山西', 'Shanxi'], ['15', '内蒙古', 'Inner Mongolia|Nei Mongol'],
  ['21', '辽宁', 'Liaoning'], ['22', '吉林', 'Jilin'], ['23', '黑龙江', 'Heilongjiang'],
  ['31', '上海', 'Shanghai'], ['32', '江苏', 'Jiangsu'], ['33', '浙江', 'Zhejiang'], ['34', '安徽', 'Anhui'], ['35', '福建', 'Fujian'], ['36', '江西', 'Jiangxi'], ['37', '山东', 'Shandong'],
  ['41', '河南', 'Henan'], ['42', '湖北', 'Hubei'], ['43', '湖南', 'Hunan'], ['44', '广东', 'Guangdong'], ['45', '广西', 'Guangxi'], ['46', '海南', 'Hainan'],
  ['50', '重庆', 'Chongqing'], ['51', '四川', 'Sichuan'], ['52', '贵州', 'Guizhou'], ['53', '云南', 'Yunnan'], ['54', '西藏', 'Tibet|Xizang'],
  ['61', '陕西', 'Shaanxi'], ['62', '甘肃', 'Gansu'], ['63', '青海', 'Qinghai'], ['64', '宁夏', 'Ningxia'], ['65', '新疆', 'Xinjiang'],
  ['71', '台湾', 'Taiwan'], ['81', '香港', 'Hong Kong|Hongkong'], ['82', '澳门', 'Macao|Macau'],
] as const;

export interface AnalyticsNetwork { ip: string; country: string; province: string; city?: string; asn?: number; operator?: string }
export function operatorForAsn(asn: number): string {
  return asn ? (operators.operators as Record<string, string>)[String(asn)] || `AS${asn}` : '未知';
}
export function networkCity(value: unknown): string {
  return typeof value === 'string' ? Array.from(value.trim().replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 96).join('') : '';
}
export function normalizeProvince(country: string, region: string, code: string): string {
  if (['HK', 'MO', 'TW'].includes(country)) return { HK: '81', MO: '82', TW: '71' }[country]!;
  if (country !== 'CN') return '';
  // Require an ISO subdivision prefix; a bare number can be a different provider's code.
  const iso = /^CN-(\d{2})$/i.exec(code)?.[1];
  if (iso && PROVINCES.some(p => p[0] === iso)) return iso;
  const name = region.trim().toLowerCase().replace(/(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/u, '').replace(/\s+(?:province|autonomous region|municipality)$/i, '').replace(/[\s_-]+/g, '');
  return PROVINCES.find(p => p[1] === name || p[2].toLowerCase().split('|').some(alias => alias.replace(/\s/g, '') === name))?.[0] || '';
}

export function analyticsNetwork(headers: Headers): AnalyticsNetwork {
  const value = headers.get('eo-connecting-ip') || (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '');
  const raw = value.includes('%') ? '' : value;
  // IPv6 URL serialization provides one canonical spelling for DISTINCT counts.
  const ip = isIP(raw) === 6 ? new URL(`http://[${raw}]`).hostname.slice(1, -1).replace(/^::ffff:(\w{1,4}):(\w{1,4})$/, (_, a, b) => `${parseInt(a, 16) >> 8}.${parseInt(a, 16) & 255}.${parseInt(b, 16) >> 8}.${parseInt(b, 16) & 255}`) : isIP(raw) === 4 ? raw : '';
  const candidate = headers.get('x-04320-geo-country') || '';
  const country = /^[A-Z]{2}$/.test(candidate) ? candidate : '';
  let region = '';
  try { region = decodeURIComponent((headers.get('x-04320-geo-region') || '').slice(0, 300)); } catch { /* Missing location stays unknown. */ }
  return { ip, country, province: normalizeProvince(country, region, headers.get('x-04320-geo-code') || '') };
}

export function verifiedAnalyticsNetwork(headers: Headers, body: unknown, now = Date.now()): AnalyticsNetwork | null {
  const proof = headers.get('x-04320-network') || '';
  const mac = headers.get('x-04320-network-signature') || '';
  const secret = process.env.ANALYTICS_INGEST_SECRET || '';
  if (!proof && process.env.NODE_ENV === 'development') {
    // Local Next dev has no EO edge runtime; never trust local geography headers.
    return analyticsNetwork(new Headers({ 'eo-connecting-ip': '127.0.0.1' }));
  }
  if (proof.length > 2000 || !/^[a-f0-9]{64}$/.test(mac) || secret.length < 32) return null;
  const expected = crypto.createHmac('sha256', secret).update(`edge-network\n${proof}\n${JSON.stringify(body)}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(decodeURIComponent(proof));
    if (!Number.isSafeInteger(data.at) || data.at > now + 10000 || now - data.at > 60000 || typeof data.ip !== 'string' || typeof data.country !== 'string' || typeof data.region !== 'string' || typeof data.code !== 'string') return null;
    const network = analyticsNetwork(new Headers({ 'eo-connecting-ip': data.ip, 'x-04320-geo-country': data.country, 'x-04320-geo-region': encodeURIComponent(data.region), 'x-04320-geo-code': data.code }));
    const asn = Number.isSafeInteger(data.asn) && data.asn > 0 && data.asn < 4294967295 ? data.asn : 0;
    return network.ip ? { ...network, city: networkCity(data.city), asn, operator: operatorForAsn(asn) } : null;
  } catch { return null; }
}

export const emptyGeoMetrics = (): AnalyticsGeoMetrics => ({ views: 0, visitors: 0, ips: 0, sessions: 0 });
export function geographyReport(data: Record<string, unknown>[], total: AnalyticsGeoMetrics, startedAt: string | null): AnalyticsGeography {
  const result: AnalyticsGeography = { provinces: PROVINCES.map(([code, name]) => ({ code, name, ...emptyGeoMetrics() })), unknown: emptyGeoMetrics(), overseas: emptyGeoMetrics(), unlocated: emptyGeoMetrics(), total, startedAt };
  for (const row of data) {
    const metrics = { views: Number(row.views || 0), visitors: Number(row.visitors || 0), ips: Number(row.ips || 0), sessions: Number(row.sessions || 0) };
    const province = result.provinces.find(p => p.code === row.region);
    if (province) Object.assign(province, metrics);
    else if (row.region === 'overseas') result.overseas = metrics;
    else if (row.region === 'CN') result.unlocated = metrics;
    else result.unknown = metrics;
  }
  return result;
}
