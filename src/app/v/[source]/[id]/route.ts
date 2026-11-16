export async function GET(req: Request, context: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await context.params;
  const index = new URL(req.url).searchParams.get('index') || '0';
  const headers = { 'Cache-Control': 'no-store' };
  if (!/^env_[0-9]{1,6}$/.test(source) || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[0-9]{1,6}$/.test(index)) {
    return new Response('无效的观影链接', { status: 404, headers });
  }
  const target = new URL('https://04320.com/watch');
  target.search = new URLSearchParams({ source, id, index: String(Number(index)) }).toString();
  return new Response(null, { status: 302, headers: { ...headers, Location: target.href } });
}
