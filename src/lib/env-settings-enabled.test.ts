import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSettingsEnabled } from './env-settings-enabled';
import { GET } from '@/app/api/status/route';

afterEach(() => vi.unstubAllEnvs());

describe('SETTINGS_ENABLED', () => {
  it.each([undefined, '', 'true', '1'])('默认或开启值 %s 保留设置', (value) => {
    vi.stubEnv('SETTINGS_ENABLED', value);
    expect(isSettingsEnabled()).toBe(true);
  });

  it.each(['false', '0', ' FALSE '])('关闭值 %s 同步到前台状态，且不改变直播开关', async (value) => {
    vi.stubEnv('SETTINGS_ENABLED', value);
    vi.stubEnv('LIVE_ENABLED', 'false');
    expect(isSettingsEnabled()).toBe(false);
    const response = await GET(new Request('https://local.test/api/status'));
    expect(await response.json()).toMatchObject({ settingsEnabled: false, liveEnabled: false });
  });
});
