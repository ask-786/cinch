import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, resolutionLabel } from './humanize';

describe('formatBytes', () => {
  it('keeps small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('switches unit at a thousand and drops the decimal once it is wide', () => {
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(15_400)).toBe('15 KB');
    expect(formatBytes(4_700_000)).toBe('4.7 MB');
    expect(formatBytes(2_100_000_000)).toBe('2.1 GB');
  });

  it('refuses to invent a size', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('reads like a media player', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(271)).toBe('4:31');
    expect(formatDuration(3729)).toBe('1:02:09');
  });

  it('handles the values FFmpeg and the DOM hand us', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDuration(-3)).toBe('—');
  });
});

describe('resolutionLabel', () => {
  it('names sizes the way people do, in either orientation', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1080, 1920)).toBe('1080p');
    expect(resolutionLabel(3840, 2160)).toBe('4K');
    expect(resolutionLabel(1280, 720)).toBe('720p');
  });

  it('falls back to the short side for odd sizes', () => {
    expect(resolutionLabel(400, 300)).toBe('300p');
    expect(resolutionLabel(undefined, 1080)).toBeUndefined();
  });
});
