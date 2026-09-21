import { describe, expect, it } from 'vitest';
import {
  buildVideoFramesArgs,
  DEFAULT_FRAMES,
  frameCount,
  frameFilter,
  MANY_FRAMES,
  videoFrames,
  type VideoFramesOptions,
} from './video-frames';

const PATHS = { inputPath: 'in.mp4', outputPath: '/out-1/%04d.jpg' };

const options = (overrides: Partial<VideoFramesOptions> = {}): VideoFramesOptions => ({
  ...DEFAULT_FRAMES,
  ...overrides,
});

describe('frameCount', () => {
  it('counts the frame at the start as well as one per interval', () => {
    expect(frameCount(options({ every: 5 }), 12)).toBe(3);
    expect(frameCount(options({ every: 1 }), 0.5)).toBe(1);
  });
});

describe('frameFilter', () => {
  it('takes the first frame, then one per interval', () => {
    expect(frameFilter(options({ every: 10 }))).toBe(
      "select='isnan(prev_selected_t)+gte(t-prev_selected_t,10)'",
    );
  });

  it('shrinks to a width but never enlarges', () => {
    expect(frameFilter(options({ width: '640' }))).toBe(
      "select='isnan(prev_selected_t)+gte(t-prev_selected_t,5)',scale='min(640,iw)':-2",
    );
  });
});

describe('buildVideoFramesArgs', () => {
  it('writes a numbered run of good-quality JPEGs', () => {
    expect(buildVideoFramesArgs(options(), PATHS)).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      "select='isnan(prev_selected_t)+gte(t-prev_selected_t,5)'",
      '-fps_mode',
      'vfr',
      '-an',
      '-q:v',
      '2',
      '-f',
      'image2',
      '/out-1/%04d.jpg',
    ]);
  });

  it('leaves the quality flag off for PNG, which is lossless', () => {
    expect(buildVideoFramesArgs(options({ format: 'png' }), PATHS)).not.toContain('-q:v');
  });
});

describe('videoFrames', () => {
  const info = (durationSeconds: number) => ({
    source: 'ffprobe' as const,
    kind: 'video' as const,
    durationSeconds,
    width: 1920,
    height: 1080,
  });

  it('warns before a run too long to fit in memory', () => {
    const long = { info: info((MANY_FRAMES + 10) * 1) };
    expect(videoFrames.preflight?.(options({ every: 1 }), long)).toHaveLength(1);
    expect(videoFrames.preflight?.(options({ every: 60 }), long)).toEqual([]);
  });

  it('estimates from the frame count and the picture size', () => {
    // 3 frames of 640 × 360 JPEG.
    const bytes = videoFrames.estimateBytes?.(options({ width: '640' }), { info: info(12) });
    expect(bytes).toBe(Math.round(3 * 640 * 360 * 0.2));
  });
});
