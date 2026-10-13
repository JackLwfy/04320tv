import { describe, expect, it } from 'vitest';
import { normalizeLogoStyle } from './brand';

describe('logo selection', () => {
  it.each(['a', 'b', 'c'] as const)('supports %s and uppercase input', (style) => {
    expect(normalizeLogoStyle(style)).toBe(style);
    expect(normalizeLogoStyle(` ${style.toUpperCase()} `)).toBe(style);
  });
  it.each([undefined, '', 'invalid', '../../secret'])('falls back safely for %s', (value) => {
    expect(normalizeLogoStyle(value)).toBe('a');
  });
});
