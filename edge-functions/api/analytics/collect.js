// Next.js middleware is handled by OpenNext; native EO geo is available here.
export async function onRequest(context) {
  const { request, env } = context;
  const json = (error, status, code = '') => new Response(JSON.stringify({ error, ...(code ? { code } : {}) }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return json('仅支持POST。', 405);
  if (!env.ADMIN_ORIGIN || request.headers.get('origin') !== env.ADMIN_ORIGIN || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json('请求来源无效。', 403);
  if (!env.ANALYTICS_INGEST_SECRET || env.ANALYTICS_INGEST_SECRET.length < 32 || !request.eo?.clientIp) return json('统计地域服务暂不可用。', 503);
  let body; let stage = 'READ'; let length = 0;
  try {
    if (Number(request.headers.get('content-length')) > 32768) return json('统计请求过大。', 400);
    // The EO runtime bounds text() at 1 MiB; reject our stricter limit before parsing.
    const text = await request.text();
    length = text.length; stage = 'SIZE';
    if (new TextEncoder().encode(text).byteLength > 32768) return json('统计请求过大。', 400);
    stage = 'PARSE';
    body = JSON.parse(text);
  } catch { return json('统计请求格式无效。', 400, `EDGE_BODY_${stage}_${length}`); }
  try {
    const geo = request.eo.geo || {};
    const proof = encodeURIComponent(JSON.stringify({ ip: request.eo.clientIp, country: geo.countryCodeAlpha2 || '', region: geo.regionName || '', code: geo.regionCode || '', at: Date.now() }));
    const text = JSON.stringify(body);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ANALYTICS_INGEST_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`edge-network\n${proof}\n${text}`));
    const signature = Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, '0')).join('');
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: env.ADMIN_ORIGIN, 'x-04320-network': proof, 'x-04320-network-signature': signature });
    for (const name of ['user-agent', 'cookie']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    return await fetch(new URL('/api/analytics/ingest', env.ADMIN_ORIGIN), { method: 'POST', headers, body: text, redirect: 'error' });
  } catch { return json('统计保存暂未确认，请稍后重试。', 503); }
}
