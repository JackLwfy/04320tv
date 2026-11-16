import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./analytics-db', () => ({ analyticsPool: () => ({ execute }) }));
import { POST } from '../app/api/newsletter/catalog/route';
import { GET } from '../app/m/[id]/route';
import { catalogAuthorized, MAX_CATALOG_BYTES, readCatalogBody } from './newsletter-catalog';

const secret = 'catalog-test-secret-'.repeat(3);
function signed(raw: string, time = String(Math.floor(Date.now() / 1000)), prefix = 'newsletter-catalog') {
  const hash = createHash('sha256').update(raw).digest('hex');
  return new Headers({ 'X-Catalog-Time': time, 'X-Catalog-Sha256': hash, 'X-Catalog-Signature': createHmac('sha256', secret).update(`${prefix}\n${time}\n${hash}`).digest('hex') });
}
function request(value: unknown) { const raw = JSON.stringify(value); return new Request('https://04320.com/api/newsletter/catalog', { method: 'POST', headers: signed(raw), body: raw }); }
function open(id = '1292052') { return GET(new Request('https://04320.com/m/' + id + '?source=evil'), { params: Promise.resolve({ id }) }); }
beforeEach(() => { execute.mockReset(); vi.stubEnv('NEWSLETTER_IMAGE_SECRET', secret); vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{name:'safe',url:'https://source.test'}, {name:'adult',url:'https://adult.test',isAdult:true}, {name:'disabled',url:'https://disabled.test',enabled:false}])); });
afterEach(() => vi.unstubAllEnvs());

describe('catalog authentication and input limits', () => {
  it('accepts only recent domain-separated signatures', async () => {
    expect(catalogAuthorized(signed('{}'))).toBe(true);
    for (const headers of [new Headers(), signed('{}', '1000000000'), signed('{}', String(Math.floor(Date.now()/1000)), 'newsletter-image')]) {
      expect((await POST(new Request('https://04320.com/api/newsletter/catalog',{method:'POST',headers,body:'{}'}))).status).toBe(401);
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects tampered hashes and invalid JSON before querying', async () => {
    for (const raw of ['bad json', '[]', 'null']) expect((await POST(new Request('https://04320.com/api/newsletter/catalog',{method:'POST',headers:signed(raw),body:raw}))).status).toBe(400);
    expect((await POST(new Request('https://04320.com/api/newsletter/catalog',{method:'POST',headers:signed('{}'),body:'{"action":"list"}'}))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('enforces actual streamed bytes, allows exactly 64KiB, and rejects declared excess', async () => {
    const raw = ' '.repeat(MAX_CATALOG_BYTES);
    expect((await readCatalogBody(new Request('https://04320.com',{method:'POST',body:raw}))).length).toBe(MAX_CATALOG_BYTES);
    const headers = signed(raw + ' '); headers.set('content-length','1');
    expect((await POST(new Request('https://04320.com',{method:'POST',headers,body:raw+' '}))).status).toBe(413);
    headers.set('content-length',String(MAX_CATALOG_BYTES + 1));
    expect((await POST(new Request('https://04320.com',{method:'POST',headers,body:'{}'}))).status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects invalid cursor, size and action', async () => {
    for (const value of [{action:'list',after_rank:-1,limit:1},{action:'list',after_rank:0,limit:101},{action:'list',after_rank:1.1,limit:10},{action:'list',after_rank:0,limit:0},{action:'delete'}]) expect((await POST(request(value))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('catalog storage and redirect', () => {
  it('uses rank cursor and includes pending rows, keeping cursor on empty page', async () => {
    execute.mockResolvedValueOnce([[{douban_id:'1',sort_rank:5,metadata_status:'pending'},{douban_id:'2',sort_rank:8,metadata_status:'ready'}]]).mockResolvedValueOnce([[]]);
    const response = await POST(request({action:'list',after_rank:3,limit:2}));
    expect(await response.json()).toMatchObject({movies:[{metadata_status:'pending'},{metadata_status:'ready'}],next_rank:8});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({sql:expect.stringContaining('WHERE sort_rank>? ORDER BY sort_rank ASC LIMIT ?')}),[3,2]);
    expect(await (await POST(request({action:'list',after_rank:8,limit:2}))).json()).toEqual({movies:[],next_rank:8});
  });
  it('stores checked mapping only for ready movies with posters', async () => {
    execute.mockResolvedValueOnce([{affectedRows:1}]).mockResolvedValueOnce([{affectedRows:0}]).mockResolvedValueOnce([[]]);
    const value = {action:'link',douban_id:'1292052',source_key:'env_0',vod_id:'abc_123-4'};
    expect(await (await POST(request(value))).json()).toEqual({url:'https://04320.com/m/1292052'});
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({sql:expect.stringContaining("metadata_status='ready' AND poster IS NOT NULL AND poster<>''")}),['env_0','abc_123-4','1292052']);
    expect(execute.mock.calls[0][0].sql).toContain("BINARY poster REGEXP '^https://04320[.]com/newsletter-images/[a-f0-9]{64}[.](jpg|png|webp)$'");
    expect((await POST(request(value))).status).toBe(400);
  });
  it('accepts an unchanged mapping when the driver reports zero affected rows', async () => {
    execute.mockResolvedValueOnce([{affectedRows:0}]).mockResolvedValueOnce([[{douban_id:'1292052'}]]);
    expect(await (await POST(request({action:'link',douban_id:'1292052',source_key:'env_0',vod_id:'123'}))).json()).toEqual({url:'https://04320.com/m/1292052'});
    expect(execute.mock.calls[1][0].sql).toContain("m.metadata_status='ready'");
    expect(execute.mock.calls[1][1]).toEqual(['1292052','env_0','123']);
  });
  it('rejects adult, disabled, missing, malformed sources and IDs', async () => {
    const value = {action:'link',douban_id:'1292052',source_key:'env_0',vod_id:'123'};
    for (const source_key of ['env_1','env_2','env_3','https://evil.test']) expect((await POST(request({...value,source_key}))).status).toBe(400);
    for (const invalid of [{douban_id:'../x'},{vod_id:'https://evil.test'}]) expect((await POST(request({...value,...invalid}))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('redirects only to the fixed site and checks source availability at click time', async () => {
    execute.mockResolvedValue([[{source_key:'env_0',vod_id:'abc_123-4'}]]);
    const response = await open();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://04320.com/watch?source=env_0&id=abc_123-4&index=0');
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const row of [{source_key:'env_1',vod_id:'123'},{source_key:'env_2',vod_id:'123'},{source_key:'env_9',vod_id:'123'},{source_key:'env_0',vod_id:'https://evil.test'}]) { execute.mockResolvedValue([[row]]); expect((await open()).status).toBe(404); }
    execute.mockResolvedValue([[]]); expect((await open()).status).toBe(404);
    execute.mockClear(); expect((await open('../bad')).status).toBe(404); expect(execute).not.toHaveBeenCalled();
  });
  it('returns generic errors without database details', async () => {
    execute.mockRejectedValue(new Error('sensitive connection details'));
    const response = await POST(request({action:'list',after_rank:0,limit:1}));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive');
    const redirect = await open(); expect(redirect.status).toBe(503); expect(redirect.headers.get('cache-control')).toBe('no-store');
  });
});
