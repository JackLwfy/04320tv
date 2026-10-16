import { describe, expect, it } from 'vitest';
import { onRequest } from '../../edge-functions/api/weather/location.js';
describe('native weather city', () => {
  it('exposes only a coarse city from native geo, never visitor headers or IP', async () => {
    const request = Object.assign(new Request('https://example.test/api/weather/location', { headers: { 'x-city': 'fake' } }), { eo: { clientIp: '192.0.2.1', geo: { countryCodeAlpha2: 'CN', cityName: '北京', regionName: '北京市', latitude: '39.901', longitude: '116.401' } } });
    const response = await onRequest({ request, env: {} });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ city: { name: '北京', region: '北京市', country: '中国', lat: 39.9, lon: 116.4 } });
    expect(await (await onRequest({ request, env: { PASSWORD: 'configured' } })).json()).toEqual({ city: null });
    request.eo.geo.latitude = '';
    expect(await (await onRequest({ request, env: {} })).json()).toEqual({ city: null });
  });
});
