import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  atempoChain,
  buildVideoSpeedArgs,
  clampFactor,
  DEFAULT_SPEED,
  videoSpeed,
  type VideoSpeedOptions,
} from './video-speed';

const PATHS = { inputPath: 'in.mp4', outputPath: 'out.mp4' };

const options = (overrides: Partial<VideoSpeedOptions> = {}): VideoSpeedOptions => ({
  ...DEFAULT_SPEED,
  ...overrides,
});

const info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  durationSeconds: 60,
  bitrate: 4_000_000,
  hasVideo: true,
  hasAudio: true,
};

describe('clampFactor', () => {
  it('keeps a sensible factor as it is', () => {
    expect(clampFactor(2)).toBe(2);
    expect(clampFactor(0.5)).toBe(0.5);
  });

  it('treats an empty or nonsense box as no change at all', () => {
    expect(clampFactor(undefined)).toBe(1);
    expect(clampFactor(0)).toBe(1);
    expect(clampFactor(-3)).toBe(1);
  });

  it('holds the factor inside what the filters will accept', () => {
    expect(clampFactor(500)).toBe(10);
    expect(clampFactor(0.001)).toBe(0.1);
  });
});

describe('atempoChain', () => {
  it('uses one step when the filter can take the factor directly', () => {
    expect(atempoChain(2)).toEqual([2]);
    expect(atempoChain(1.5)).toEqual([1.5]);
    expect(atempoChain(0.5)).toEqual([0.5]);
  });

  it('splits a larger speed-up into steps atempo will accept', () => {
    expect(atempoChain(4)).toEqual([2, 2]);
    expect(atempoChain(8)).toEqual([2, 2, 2]);
  });

  it('splits a larger slow-down the same way', () => {
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
  });

  it('multiplies out to the factor that was asked for', () => {
    for (const factor of [0.25, 0.4, 1.5, 3, 4, 7]) {
      const product = atempoChain(factor).reduce((total, step) => total * step, 1);
      expect(product).toBeCloseTo(clampFactor(factor), 4);
    }
  });
});

describe('buildVideoSpeedArgs', () => {
  it('restamps the frames and stretches the sound to match', () => {
    const args = buildVideoSpeedArgs(options({ factor: 2 }), PATHS);

    expect(args.slice(0, 6)).toEqual(['-i', 'in.mp4', '-vf', 'setpts=PTS/2', '-af', 'atempo=2']);
    // Filtered audio cannot be copied through.
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
  });

  it('chains atempo for a factor the filter cannot take alone', () => {
    const args = buildVideoSpeedArgs(options({ factor: 4 }), PATHS);
    expect(args[args.indexOf('-af') + 1]).toBe('atempo=2,atempo=2');
  });

  it('drops the sound instead of stretching it when asked', () => {
    const args = buildVideoSpeedArgs(options({ factor: 2, keepAudio: false }), PATHS);
    expect(args).not.toContain('-af');
    expect(args).toContain('-an');
  });

  it('writes a factor a person could read back', () => {
    const args = buildVideoSpeedArgs(options({ factor: 1.5 }), PATHS);
    expect(args).toContain('setpts=PTS/1.5');
  });
});

describe('the speed descriptor', () => {
  it('shortens the output when the video is sped up', () => {
    expect(videoSpeed.outputDuration?.(options({ factor: 2 }), { info })).toBe(30);
    expect(videoSpeed.outputDuration?.(options({ factor: 0.5 }), { info })).toBe(120);
  });

  it('warns that 1x is a re-encode for nothing', () => {
    const warnings = videoSpeed.preflight?.(options({ factor: 1 }), { info });
    expect(warnings?.[0]).toMatch(/nothing changes/);
  });

  it('warns about the sound on a very large change', () => {
    const warnings = videoSpeed.preflight?.(options({ factor: 8 }), { info });
    expect(warnings?.some((warning) => /sounding processed/.test(warning))).toBe(true);
  });

  it('leaves a half-typed box alone rather than snapping it back', () => {
    const normalized = videoSpeed.normalize?.(options({ factor: undefined }), {});
    expect(normalized?.['factor']).toBeUndefined();
  });

  it('pulls an out-of-range number back into range', () => {
    const normalized = videoSpeed.normalize?.(options({ factor: 99 }), {});
    expect(normalized?.['factor']).toBe(10);
  });
});
