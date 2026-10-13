/** 默认开启，部署者可通过 LIVE_ENABLED=false（或 0）关闭直播。 */
export function isLiveEnabled(): boolean {
  return !['false', '0'].includes(process.env.LIVE_ENABLED?.trim().toLowerCase() ?? '');
}
