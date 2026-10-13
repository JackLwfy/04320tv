/** 默认开启，部署者可通过 SETTINGS_ENABLED=false（或 0）关闭前台设置。 */
export function isSettingsEnabled(): boolean {
  return !['false', '0'].includes(process.env.SETTINGS_ENABLED?.trim().toLowerCase() ?? '');
}
