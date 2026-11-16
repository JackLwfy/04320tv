import { expect, it } from 'vitest';
import { GET } from '@/app/v/[source]/[id]/route';
it('resolves only site watch URLs and ignores injected destinations', async () => {
  const r = await GET(new Request('https://04320.com/v/env_1/123?index=2&sourceUrl=https://evil.test'), { params: Promise.resolve({ source: 'env_1', id: '123' }) });
  expect(r.status).toBe(302);
  expect(r.headers.get('location')).toBe('https://04320.com/watch?source=env_1&id=123&index=2');
  for (const source of ['../watch', 'https://evil.test', 'custom']) {
    expect((await GET(new Request('https://04320.com'), { params: Promise.resolve({ source, id: '123' }) })).status).toBe(404);
  }
});
