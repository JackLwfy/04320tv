// EdgeOne Makers middleware; geo is supplied by the platform, never by the browser.
export function middleware(context) {
  const geo = context.geo || {};
  return context.next({ headers: {
    'x-04320-geo-country': geo.countryCodeAlpha2 || '',
    'x-04320-geo-region': encodeURIComponent(geo.regionName || ''),
    'x-04320-geo-code': geo.regionCode || '',
    'eo-connecting-ip': context.clientIp || '',
  } });
}

export const config = { matcher: ['/api/analytics/collect', '/api/analytics/session'] };
