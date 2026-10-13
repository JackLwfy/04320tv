import { describe, expect, it } from 'vitest';
import { canPromptNewsletter, newsletterDay } from './newsletter-prompt';

describe('newsletter daily prompt', () => {
  it('allows first visit, suppresses the same local day and resets at midnight', () => {
    const beforeMidnight = new Date(2026, 9, 14, 23, 59);
    expect(canPromptNewsletter({ getItem: () => null }, beforeMidnight)).toBe(true);
    const storage = { getItem: () => newsletterDay(beforeMidnight) };
    expect(canPromptNewsletter(storage, new Date(2026, 9, 14, 12))).toBe(false);
    expect(canPromptNewsletter(storage, new Date(2026, 9, 15, 0))).toBe(true);
    expect(canPromptNewsletter(storage, new Date(2027, 9, 14))).toBe(true);
  });
  it('does not repeatedly interrupt visitors when storage is blocked', () => {
    expect(canPromptNewsletter({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });
});
