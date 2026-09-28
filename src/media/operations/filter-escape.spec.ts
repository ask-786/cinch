import { describe, expect, it } from 'vitest';
import { escapeFilterValue } from './filter-escape';

describe('escapeFilterValue', () => {
  it('leaves ordinary words alone', () => {
    expect(escapeFilterValue('Summer 2026 — ünïcode')).toBe('Summer 2026 — ünïcode');
  });

  it('escapes for the option and then for the graph', () => {
    expect(escapeFilterValue(`It's 12:30`)).toBe(`It\\\\\\'s 12\\\\:30`);
    expect(escapeFilterValue('[a,b];')).toBe('\\[a\\,b\\]\\;');
    expect(escapeFilterValue('c\\d')).toBe('c\\\\\\\\d');
  });
});
