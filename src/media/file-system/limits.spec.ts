import { describe, expect, it } from 'vitest';
import { DESKTOP_WARN_BYTES, MOBILE_CAP_BYTES, preflightSize } from './limits';

const MB = 1_000_000;

describe('preflightSize', () => {
  it('passes ordinary files on either kind of device', () => {
    expect(preflightSize(40 * MB, false).level).toBe('ok');
    expect(preflightSize(40 * MB, true).level).toBe('ok');
  });

  it('warns rather than blocks on a desktop', () => {
    const result = preflightSize(DESKTOP_WARN_BYTES + 1, false);
    expect(result.level).toBe('warn');
    expect(result.message).toContain('500 MB');
  });

  it('blocks on mobile, where the tab is killed instead of told', () => {
    const result = preflightSize(MOBILE_CAP_BYTES + 1, true);
    expect(result.level).toBe('block');
    expect(result.message).toContain('computer');
  });

  it('treats the limits themselves as allowed', () => {
    expect(preflightSize(DESKTOP_WARN_BYTES, false).level).toBe('ok');
    expect(preflightSize(MOBILE_CAP_BYTES, true).level).toBe('ok');
  });
});
