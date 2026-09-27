import { describe, expect, it } from 'vitest';
import { audioVolume, clampGain, DEFAULT_VOLUME, volumeFilter } from './audio-volume';

describe('volumeFilter', () => {
  it('limits a boost so the peaks do not clip', () => {
    expect(volumeFilter({ gainDb: 6 })).toBe('volume=6dB,alimiter=limit=0.891:level=disabled');
  });

  it('needs no limiter to turn the sound down', () => {
    expect(volumeFilter({ gainDb: -6 })).toBe('volume=-6dB');
  });

  it('keeps the gain inside ±30 dB', () => {
    expect(clampGain(80)).toBe(30);
    expect(clampGain(-80)).toBe(-30);
    expect(clampGain(undefined)).toBe(0);
  });
});

describe('the volume descriptor', () => {
  it('leaves a half-typed box alone', () => {
    expect(audioVolume.normalize?.({ gainDb: undefined }, {})).toEqual({ gainDb: undefined });
  });

  it('points out a change that changes nothing', () => {
    expect(audioVolume.preflight?.({ gainDb: 0 }, {})?.join(' ')).toMatch(/nothing changes/);
    expect(audioVolume.preflight?.(DEFAULT_VOLUME, {})).toEqual([]);
  });
});
