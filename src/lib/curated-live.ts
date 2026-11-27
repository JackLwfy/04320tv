import type { LiveSourceConfig } from './types';

/** 人工筛选并验证的清单随仓库更新，不自动导入上游全部频道。 */
export const curatedLiveSource: LiveSourceConfig = {
  key: 'curated_iptv_org_v1',
  name: '04320 精选直播',
  url: 'https://raw.githubusercontent.com/JackLwfy/04320tv/main/public/live/curated.m3u',
};

export function isCuratedLiveEnabled(): boolean {
  return !['false', '0'].includes(process.env.CURATED_LIVE_ENABLED?.trim().toLowerCase() ?? '');
}
