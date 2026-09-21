import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoThumbnailsArgs,
  DEFAULT_THUMBNAILS,
  sheetFilter,
  sheetInterval,
  tileCount,
  videoThumbnails,
  type VideoThumbnailsOptions,
} from './video-thumbnails';

const options = (overrides: Partial<VideoThumbnailsOptions> = {}): VideoThumbnailsOptions => ({
  ...DEFAULT_THUMBNAILS,
  ...overrides,
});

const info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  width: 1920,
  height: 1080,
  durationSeconds: 160,
};

describe('sheetInterval', () => {
  it('spaces the frames evenly across the whole length', () => {
    expect(tileCount(options({ grid: '4' }))).toBe(16);
    expect(sheetInterval(options({ grid: '4' }), 160)).toBe(10);
    expect(sheetInterval(options({ grid: '3' }), 10)).toBe(1.111);
  });
});

describe('sheetFilter', () => {
  it('picks by timestamp, shrinks each frame, and tiles them', () => {
    expect(sheetFilter(options(), 10)).toBe(
      "select='isnan(prev_selected_t)+gte(t-prev_selected_t,10)',scale=320:-2,tile=4x4:padding=4:margin=4",
    );
  });
});

describe('buildVideoThumbnailsArgs', () => {
  it('writes one picture from the spaced frames', () => {
    const args = buildVideoThumbnailsArgs(
      options(),
      { inputPath: 'in.mp4', outputPath: 'out.jpg' },
      160,
    );
    expect(args).toContain(sheetFilter(options(), 10));
    expect(args.join(' ')).toContain('-frames:v 1 -q:v 2 -update 1 out.jpg');
  });

  it('leaves the JPEG quality out of a PNG', () => {
    const args = buildVideoThumbnailsArgs(
      options({ format: 'png' }),
      { inputPath: 'in.mp4', outputPath: 'out.png' },
      160,
    );
    expect(args).not.toContain('-q:v');
  });
});

describe('videoThumbnails', () => {
  it('waits for the length before it can space anything', () => {
    expect(
      videoThumbnails.preflight?.(options(), { info: { ...info, durationSeconds: undefined } }),
    ).toHaveLength(1);
    expect(videoThumbnails.preflight?.(options(), { info })).toEqual([]);
  });

  it('estimates the sheet from its size in pixels', () => {
    // 4 tiles of 324 px plus the margin, by 4 tiles of 184 px plus the margin.
    expect(videoThumbnails.estimateBytes?.(options(), { info })).toBe(Math.round(1300 * 740 * 0.2));
  });
});
