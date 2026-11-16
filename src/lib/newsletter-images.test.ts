import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
const execute = vi.hoisted(() => vi.fn());
vi.mock('./analytics-db', () => ({ analyticsPool: () => ({ execute }) }));
import { IMAGE_NAME, imageType, imageUploadAuthorized, loadNewsletterImage, MAX_IMAGE_BYTES, readImageBody, saveNewsletterImage } from './newsletter-images';
import { POST } from '@/app/api/newsletter/images/route';
import { GET } from '@/app/newsletter-images/[name]/route';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const hash = createHash('sha256').update(image).digest('hex');
const secret = 'test-secret-only-at-least-thirty-two-characters';
function headers(time = String(Math.floor(Date.now()/1000))) { return new Headers({ 'x-image-time': time, 'x-image-sha256': hash, 'x-image-signature': createHmac('sha256',secret).update(`newsletter-image\n${time}\n${hash}`).digest('hex') }); }
afterEach(() => { vi.unstubAllEnvs(); execute.mockReset(); });
describe('permanent newsletter images', () => {
 it('requires a valid recent server signature', async () => { vi.stubEnv('NEWSLETTER_IMAGE_SECRET',secret); expect(imageUploadAuthorized(headers())).toBe(true); expect(imageUploadAuthorized(headers('1000000000'))).toBe(false); expect(imageUploadAuthorized(new Headers())).toBe(false); const r=await POST(new Request('https://04320.com/api/newsletter/images',{method:'POST',body:image})); expect(r.status).toBe(401); expect(execute).not.toHaveBeenCalled(); });
 it('rejects executable or oversized input and hash mismatch', async () => { expect(imageType(Buffer.from('<svg onload="alert(1)">'))).toBeNull(); expect(imageType(Buffer.alloc(MAX_IMAGE_BYTES+1))).toBeNull(); await expect(saveNewsletterImage(image,'0'.repeat(64))).rejects.toThrow(); await expect(readImageBody(new Request('https://test',{method:'POST',headers:{'content-length':String(MAX_IMAGE_BYTES+1)},body:image}))).rejects.toThrow(); expect(execute).not.toHaveBeenCalled(); });
 it('stores bytes once by content hash without overwrite', async () => { execute.mockResolvedValue([{}]); expect(await saveNewsletterImage(image,hash)).toBe(`https://04320.com/newsletter-images/${hash}.png`); expect(execute.mock.calls[0][0].sql).toContain('INSERT IGNORE'); expect(execute.mock.calls[0][1][2]).toEqual(image); });
 it('serves saved bytes without upstream requests and never caches missing images', async () => { execute.mockResolvedValue([[{mime:'image/png',body:image}]]); const r=await GET(new Request('https://04320.com'),{params:Promise.resolve({name:hash+'.png'})}); expect(r.status).toBe(200); expect(Buffer.from(await r.arrayBuffer())).toEqual(image); expect(r.headers.get('cache-control')).toContain('immutable'); const n=await GET(new Request('https://04320.com',{headers:{'if-none-match':`"${hash}"`}}),{params:Promise.resolve({name:hash+'.png'})}); expect(n.status).toBe(304); expect(await loadNewsletterImage(hash+'.jpg')).toBeNull(); expect(IMAGE_NAME.test('../etc/passwd')).toBe(false); execute.mockResolvedValue([[]]); expect((await GET(new Request('https://04320.com'),{params:Promise.resolve({name:hash+'.png'})})).headers.get('cache-control')).toBe('no-store'); });
});
