import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { curatedLiveSource } from './curated-live';
import { getEnvLiveSources } from './env-live-sources';
import { parseM3u } from './m3u-parser';
import { settingsFromEnv, settingsToEnv } from './admin-config';
import { GET as status } from '@/app/api/status/route';

afterEach(() => vi.unstubAllEnvs());

describe('curated live channels', () => {
  it('includes the curated playlist by default without replacing custom sources', () => {
    vi.stubEnv('CURATED_LIVE_ENABLED', undefined);
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([{ name: '自定义', url: 'https://example.com/live.m3u' }]));
    expect(getEnvLiveSources().map(s => s.url)).toEqual([curatedLiveSource.url, 'https://example.com/live.m3u']);
    vi.stubEnv('CURATED_LIVE_ENABLED', 'false');
    expect(getEnvLiveSources().map(s => s.name)).toEqual(['自定义']);
  });

  it('does not duplicate or re-enable an explicitly configured curated URL', () => {
    vi.stubEnv('CURATED_LIVE_ENABLED', 'true');
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([{ ...curatedLiveSource, enabled: false }]));
    expect(getEnvLiveSources()).toEqual([]);
  });

  it('round trips admin switches and preserves sources while the whole column is closed', async () => {
    const previous = { LIVE_ENABLED: '0', CURATED_LIVE_ENABLED: ' FALSE ', DEFAULT_LIVE_SOURCES: '[{"name":"自定义","url":"https://example.com/live.m3u","epg":"https://example.com/epg.xml"}]' };
    const draft = settingsFromEnv(previous);
    expect(draft).toMatchObject({ live: false, curatedLive: false });
    draft.curatedLive = true;
    const env = settingsToEnv(draft, previous);
    expect(env).toMatchObject({ LIVE_ENABLED: 'false', CURATED_LIVE_ENABLED: 'true' });
    expect(JSON.parse(env.DEFAULT_LIVE_SOURCES)[0].epg).toBe('https://example.com/epg.xml');
    for (const key of ['LIVE_ENABLED', 'CURATED_LIVE_ENABLED', 'DEFAULT_LIVE_SOURCES']) vi.stubEnv(key, env[key]);
    expect(await (await status(new Request('https://example.com/api/status'))).json()).toMatchObject({ liveEnabled: false, defaultLiveSources: [] });
    vi.stubEnv('LIVE_ENABLED', 'true');
    expect((await (await status(new Request('https://example.com/api/status'))).json()).defaultLiveSources).toHaveLength(2);
  });

  it('ships a nonempty, unique HTTPS playlist compatible with the existing parser', () => {
    const channels = parseM3u(readFileSync('public/live/curated.m3u', 'utf8'));
    expect(channels.length).toBeGreaterThanOrEqual(3);
    expect(new Set(channels.map(c => c.tvgId)).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel.url).toMatch(/^https:\/\//);
      expect(channel.name).toBeTruthy();
      expect(channel.group).toBeTruthy();
    }
  });
});
