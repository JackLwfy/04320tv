import { describe, expect, it } from 'vitest';
import { changes, describeValue, initialSettings, validateSettings } from './demo-model';

describe('admin prototype configuration', () => {
  it('tracks reversible changes without altering the published snapshot', () => {
    const draft = structuredClone(initialSettings);
    draft.live = false;
    draft.sources[0].name = '新的源';
    expect(changes(initialSettings, draft)).toEqual(['live', 'sources']);
    expect(describeValue(draft.sources)).toContain('新的源');
    expect(describeValue(draft.sources)).not.toBe(describeValue(initialSettings.sources));
    expect(initialSettings.live).toBe(true);
    expect(changes(initialSettings, structuredClone(initialSettings))).toEqual([]);
  });
  it('validates the whole draft, including hidden source tabs', () => {
    expect(validateSettings(initialSettings)).toBeNull();
    expect(validateSettings({ ...initialSettings, name: ' ' })?.section).toBe('site');
    expect(validateSettings({ ...initialSettings, description: '中'.repeat(201) })?.section).toBe('site');
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.com', 'not-a-url']) {
      expect(validateSettings({ ...initialSettings, sources: [{ ...initialSettings.sources[0], url }] })?.section).toBe('sources');
    }
  });
});
