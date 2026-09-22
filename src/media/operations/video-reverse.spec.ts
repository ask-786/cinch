import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoReverseArgs,
  DEFAULT_REVERSE,
  reverseBufferBytes,
  reverseSizeChoices,
  videoReverse,
  type VideoReverseOptions,
} from './video-reverse';

const PATHS = { inputPath: 'in.mp4', outputPath: 'out.mp4' };

const options = (overrides: Partial<VideoReverseOptions> = {}): VideoReverseOptions => ({
  ...DEFAULT_REVERSE,
  ...overrides,
});

const clip = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width: 1280,
  height: 720,
  frameRate: 30,
  durationSeconds: 6,
  hasVideo: true,
  hasAudio: true,
  bitrate: 2_000_000,
  ...overrides,
});

describe('reverseBufferBytes', () => {
  it('counts every raw frame of the clip, plus the sound', () => {
    // 1280 × 720 × 1.5 bytes × 30 fps × 6 s, and 48 kHz stereo floats.
    expect(reverseBufferBytes(clip(), 0)).toBe(1280 * 720 * 1.5 * 180 + 48_000 * 8 * 6);
  });

  it('buffers a quarter as much at half the height', () => {
    const silent = clip({ hasAudio: false });
    expect(reverseBufferBytes(silent, 360)).toBe((reverseBufferBytes(silent, 0) ?? 0) / 4);
  });

  it('knows nothing until the size and length are read', () => {
    expect(reverseBufferBytes(clip({ width: undefined }), 0)).toBeUndefined();
  });
});

describe('reverseSizeChoices', () => {
  it('only offers sizes smaller than the source', () => {
    expect(reverseSizeChoices(clip()).map((choice) => choice.value)).toEqual([0, 480, 360]);
  });

  it('rules out the sizes that would not fit in memory', () => {
    // 1080p30 for 30 s is about 2.8 GB raw; 360p is a ninth of that.
    const long = clip({ width: 1920, height: 1080, durationSeconds: 30 });
    const disabled = reverseSizeChoices(long).filter((choice) => choice.disabled);
    expect(disabled.map((choice) => choice.value)).toEqual([0, 720, 480]);
  });
});

describe('buildVideoReverseArgs', () => {
  it('reverses the picture and the sound', () => {
    expect(buildVideoReverseArgs(options(), PATHS, clip())).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      'reverse',
      '-af',
      'areverse',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
  });

  it('shrinks the frame before it is buffered, not after', () => {
    const args = buildVideoReverseArgs(options({ height: 360 }), PATHS, clip());
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=-2:360,reverse');
  });

  it('drops the sound when asked, or when there is none', () => {
    expect(buildVideoReverseArgs(options({ keepAudio: false }), PATHS, clip())).toContain('-an');
    const silent = buildVideoReverseArgs(options(), PATHS, clip({ hasAudio: false }));
    expect(silent).not.toContain('-af');
    expect(silent).toContain('-an');
  });
});

describe('the reverse descriptor', () => {
  it('moves to the largest size that fits', () => {
    const long = clip({ width: 1920, height: 1080, durationSeconds: 30 });
    expect(videoReverse.normalize?.(options(), { info: long })).toMatchObject({ height: 360 });
  });

  it('turns away a clip too long to fit at any size', () => {
    const film = clip({ durationSeconds: 3600 });
    expect(videoReverse.rejects?.({ info: film })).toMatch(/too long/);
    expect(videoReverse.rejects?.({ info: clip() })).toBeUndefined();
  });

  it('warns when the buffer gets large but still fits', () => {
    const minute = clip({ durationSeconds: 60 });
    expect(videoReverse.preflight?.(options({ height: 0 }), { info: minute })?.[0]).toMatch(
      /in memory/,
    );
    const short = clip({ durationSeconds: 3 });
    expect(videoReverse.preflight?.(options(), { info: short })).toEqual([]);
  });
});
