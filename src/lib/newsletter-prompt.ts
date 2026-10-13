export const NEWSLETTER_DISMISSED_KEY = 'newsletter-dismissed-day';

export function newsletterDay(now = new Date()) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function canPromptNewsletter(storage: Pick<Storage, 'getItem'>, now = new Date()) {
  try {
    return storage.getItem(NEWSLETTER_DISMISSED_KEY) !== newsletterDay(now);
  } catch {
    // 无法保存关闭记录时不自动打扰，仍保留手动入口。
    return false;
  }
}
