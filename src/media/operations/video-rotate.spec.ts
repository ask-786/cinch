import { describe, expect, it } from 'vitest';
import {
  buildVideoRotateArgs,
  DEFAULT_ROTATE,
  rotateFilter,
  swapsDimensions,
  videoRotate,
  type VideoRotateOptions,
} from './video-rotate';

const PATHS = { inputPath: 'in.mp4', outputPath: 'out.mp4' };

const options = (overrides: Partial<VideoRotateOptions> = {}): VideoRotateOptions => ({
  ...DEFAULT_ROTATE,
  ...overrides,
});

describe('rotateFilter', () => {
  it('turns a quarter clockwise and anticlockwise', () => {
    expect(rotateFilter(options({ turn: 'right' }))).toBe('transpose=1');
    expect(rotateFilter(options({ turn: 'left' }))).toBe('transpose=2');
  });

  it('makes a half turn out of two quarter turns', () => {
    expect(rotateFilter(options({ turn: 'half' }))).toBe('transpose=1,transpose=1');
  });

  it('mirrors without turning', () => {
    expect(rotateFilter(options({ turn: 'none', mirror: 'horizontal' }))).toBe('hflip');
    expect(rotateFilter(options({ turn: 'none', mirror: 'vertical' }))).toBe('vflip');
  });

  it('chains a turn and a mirror in that order', () => {
    expect(rotateFilter(options({ turn: 'right', mirror: 'horizontal' }))).toBe(
      'transpose=1,hflip',
    );
  });

  it('has nothing to do when neither is asked for', () => {
    expect(rotateFilter(options({ turn: 'none', mirror: 'none' }))).toBeUndefined();
  });
});

describe('swapsDimensions', () => {
  it('is true only for a quarter turn', () => {
    expect(swapsDimensions(options({ turn: 'right' }))).toBe(true);
    expect(swapsDimensions(options({ turn: 'left' }))).toBe(true);
    expect(swapsDimensions(options({ turn: 'half' }))).toBe(false);
    expect(swapsDimensions(options({ turn: 'none' }))).toBe(false);
  });
});

describe('buildVideoRotateArgs', () => {
  it('turns the picture and copies the sound untouched', () => {
    const args = buildVideoRotateArgs(options({ turn: 'right' }), PATHS);

    expect(args).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      'transpose=1',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
  });

  it('leaves the filter out when there is nothing to turn', () => {
    const args = buildVideoRotateArgs(options({ turn: 'none', mirror: 'none' }), PATHS);
    expect(args).not.toContain('-vf');
  });
});

describe('the rotate descriptor', () => {
  it('warns that doing nothing still costs a re-encode', () => {
    const warnings = videoRotate.preflight?.(options({ turn: 'none', mirror: 'none' }), {});
    expect(warnings?.[0]).toMatch(/for no reason/);
  });

  it('says nothing when there is a turn to make', () => {
    expect(videoRotate.preflight?.(options({ turn: 'right' }), {})).toEqual([]);
  });

  it('turns a file with no picture away', () => {
    expect(
      videoRotate.rejects?.({ info: { source: 'ffprobe', kind: 'audio', hasVideo: false } }),
    ).toMatch(/no picture/);
  });
});
