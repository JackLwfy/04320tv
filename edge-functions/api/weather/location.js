export async function onRequest({ request, env }) {
  const reply = (city, status = 200) => new Response(JSON.stringify({ city }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', Vary: 'Cookie' } });
  if (request.method !== 'GET') return reply(null, 405);
  // Password-protected sites use manual cities; avoid duplicating the Node session verifier.
  if (env.PASSWORD) return reply(null);
  const geo = request.eo?.geo;
  const lat = geo?.latitude; const lon = geo?.longitude;
  if (!geo || geo.countryCodeAlpha2 !== 'CN' || typeof geo.cityName !== 'string' || !geo.cityName || geo.cityName.length > 80 || lat == null || lon == null || String(lat).trim() === '' || String(lon).trim() === '' || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) return reply(null);
  return reply({ name: geo.cityName, region: typeof geo.regionName === 'string' ? geo.regionName.slice(0, 80) : '', country: '中国', lat: Number(Number(lat).toFixed(2)), lon: Number(Number(lon).toFixed(2)) });
}
