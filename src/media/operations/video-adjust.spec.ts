import { describe, expect, it } from 'vitest';
import {
  adjustFilter,
  buildVideoAdjustArgs,
  DEFAULT_ADJUST,
  eqFilter,
  sharpnessFilter,
  videoAdjust,
  type VideoAdjustOptions,
} from './video-adjust';

const options = (overrides: Partial<VideoAdjustOptions> = {}): VideoAdjustOptions => ({
  ...DEFAULT_ADJUST,
  ...overrides,
});

describe('eqFilter', () => {
  it('only names the settings that moved', () => {
    expect(eqFilter(options({ brightness: 40 }))).toBe('eq=brightness=0.1');
    expect(eqFilter(options({ contrast: 50, saturation: -100 }))).toBe(
      'eq=contrast=1.25:saturation=0',
    );
  });

  it('keeps the far ends of the sliders short of white-out', () => {
    expect(eqFilter(options({ brightness: 100, contrast: -100, saturation: 100 }))).toBe(
      'eq=brightness=0.25:contrast=0.5:saturation=2',
    );
  });

  it('has nothing to say at zero', () => {
    expect(eqFilter(options())).toBeUndefined();
  });
});

describe('sharpnessFilter', () => {
  it('blurs below zero and sharpens above it', () => {
    expect(sharpnessFilter(-30)).toBe('gblur=sigma=3');
    expect(sharpnessFilter(50)).toBe('unsharp=5:5:0.75');
    expect(sharpnessFilter(0)).toBeUndefined();
  });
});

describe('buildVideoAdjustArgs', () => {
  it('chains colour before sharpness in one filter', () => {
    const args = buildVideoAdjustArgs(options({ saturation: 20, sharpness: 100 }), {
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
    });
    expect(args.slice(0, 4)).toEqual(['-i', 'in.mp4', '-vf', 'eq=saturation=1.2,unsharp=5:5:1.5']);
    expect(args).toContain('copy');
  });

  it('leaves the filter out when nothing moved', () => {
    expect(adjustFilter(options())).toBeUndefined();
    expect(
      buildVideoAdjustArgs(options(), { inputPath: 'in.mp4', outputPath: 'out.mp4' }),
    ).not.toContain('-vf');
  });
});

describe('the adjust descriptor', () => {
  it('warns that doing nothing still costs a re-encode', () => {
    expect(videoAdjust.preflight?.(options(), {})?.[0]).toMatch(/for no reason/);
    expect(videoAdjust.preflight?.(options({ contrast: 10 }), {})).toEqual([]);
  });
});
