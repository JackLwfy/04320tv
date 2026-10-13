import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLiveEnabled } from './env-live-enabled';
import { guardRequest } from './api-guard';
import { SESSION_COOKIE, signSession } from './auth';
import { GET as status } from '@/app/api/status/route';
import { GET as playlist } from '@/app/api/live/playlist/route';
import { GET as epg } from '@/app/api/live/epg/route';
import { POST as probe } from '@/app/api/live/probe/route';
import { GET as stream } from '@/app/api/live/stream/route';
import { GET as legacyStream } from '@/app/api/live/stream/[url]/route';
import LiveLayout from '@/app/live/layout';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('LIVE_ENABLED', () => {
  it.each([undefined, '', 'true', '1'])('默认或开启值 %s 保留直播', (value) => {
    vi.stubEnv('LIVE_ENABLED', value);
    expect(isLiveEnabled()).toBe(true);
    expect(LiveLayout({ children: 'live content' })).toBe('live content');
  });

  it.each(['false', '0', ' FALSE '])('关闭值 %s 拦截直播页面', (value) => {
    vi.stubEnv('LIVE_ENABLED', value);
    expect(isLiveEnabled()).toBe(false);
    expect(() => LiveLayout({ children: 'live content' })).toThrow('NEXT_REDIRECT');
  });

  it('关闭后所有直播路由均拒绝请求，且不请求上游', async () => {
    vi.stubEnv('LIVE_ENABLED', 'false');
    vi.stubEnv('PASSWORD', 'test-password');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const cookie = `${SESSION_COOKIE}=${signSession().token}`;
    const req = (path: string) => new Request(`https://local.test/api/live/${path}`, { headers: { cookie } });
    const responses = await Promise.all([
      playlist(req('playlist?url=https://example.com/list.m3u')),
      epg(req('epg?url=https://example.com/epg.xml')),
      probe(req('probe')),
      stream(req('stream?url=https://example.com/video.m3u8')),
      stream(req('stream')),
      legacyStream(req('stream/https%3A%2F%2Fexample.com%2Fvideo.m3u8'), {
        params: Promise.resolve({ url: 'https%3A%2F%2Fexample.com%2Fvideo.m3u8' }),
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: '直播功能已关闭' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(guardRequest(new Request('https://local.test/api/search', { headers: { cookie } }))).toBeNull();
  });

  it('状态接口同步开关，关闭时不下发直播源，重新开启可恢复', async () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', '[{"name":"Test","url":"https://example.com/list.m3u"}]');
    vi.stubEnv('LIVE_ENABLED', 'false');
    const response = await status(new Request('https://local.test/api/status'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ liveEnabled: false, defaultLiveSources: [] });
    vi.stubEnv('LIVE_ENABLED', 'true');
    const enabled = await (await status(new Request('https://local.test/api/status'))).json();
    expect(enabled.liveEnabled).toBe(true);
    expect(enabled.defaultLiveSources).toHaveLength(1);
  });
});
