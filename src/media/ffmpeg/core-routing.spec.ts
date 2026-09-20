import { describe, expect, it } from 'vitest';
import { chooseCore, MT_MAX_OUTPUT_BYTES, type Capabilities } from './core-routing';

const capable: Capabilities = {
  isolated: true,
  sharedArrayBuffer: true,
  hardwareConcurrency: 8,
  multithreadAvailable: true,
};

describe('chooseCore', () => {
  it('takes the fast core for ordinary jobs', () => {
    expect(chooseCore({ estimatedOutputBytes: 40_000_000, sourceHeight: 1080 }, capable)).toBe('mt');
  });

  it('falls back when the page is not isolated', () => {
    const caps = { ...capable, isolated: false, multithreadAvailable: false };
    expect(chooseCore({ estimatedOutputBytes: 1_000_000 }, caps)).toBe('st');
  });

  it('avoids the fixed 1 GB heap for large output', () => {
    expect(chooseCore({ estimatedOutputBytes: MT_MAX_OUTPUT_BYTES }, capable)).toBe('st');
    expect(chooseCore({ estimatedOutputBytes: MT_MAX_OUTPUT_BYTES - 1 }, capable)).toBe('mt');
  });

  it('avoids it for sources above 1080p', () => {
    expect(chooseCore({ estimatedOutputBytes: 10_000_000, sourceHeight: 2160 }, capable)).toBe('st');
  });

  it('treats an unknown output size as a reason to be careful', () => {
    expect(chooseCore({}, capable)).toBe('st');
  });
});
