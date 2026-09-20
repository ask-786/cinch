import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoResizeArgs,
  DEFAULT_RESIZE,
  resizedDimensions,
  resizeFilter,
  videoResize,
  type VideoResizeOptions,
} from './video-resize';

const PATHS = { inputPath: 'in.mp4', outputPath: 'out.mp4' };

const options = (overrides: Partial<VideoResizeOptions> = {}): VideoResizeOptions => ({
  ...DEFAULT_RESIZE,
  ...overrides,
});

const source = (width: number, height: number): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width,
  height,
  durationSeconds: 60,
  frameRate: 30,
  hasVideo: true,
  hasAudio: true,
});

describe('resizeFilter', () => {
  it('scales to a preset height and lets the width follow', () => {
    expect(resizeFilter(options({ mode: 'preset', preset: 720 }))).toBe('scale=-2:720');
  });

  it('follows the aspect ratio when only one side is typed in', () => {
    expect(resizeFilter(options({ mode: 'custom', width: 640 }))).toBe('scale=640:-2');
    expect(resizeFilter(options({ mode: 'custom', height: 480 }))).toBe('scale=-2:480');
  });

  it('fits inside both numbers while the shape is kept', () => {
    expect(resizeFilter(options({ mode: 'custom', width: 640, height: 480 }))).toBe(
      'scale=640:480:force_original_aspect_ratio=decrease',
    );
  });

  it('uses both numbers exactly once the shape is unlocked', () => {
    expect(
      resizeFilter(options({ mode: 'custom', width: 640, height: 480, keepAspect: false })),
    ).toBe('scale=640:480');
  });

  it('rounds an odd dimension down to an even one, which every codec needs', () => {
    expect(resizeFilter(options({ mode: 'custom', width: 641 }))).toBe('scale=640:-2');
  });

  it('has nothing to do when the custom form is empty', () => {
    expect(resizeFilter(options({ mode: 'custom' }))).toBeUndefined();
  });
});

describe('buildVideoResizeArgs', () => {
  it('re-encodes the picture and copies the sound', () => {
    const args = buildVideoResizeArgs(options({ mode: 'preset', preset: 720 }), PATHS);

    expect(args).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      'scale=-2:720',
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

  it('leaves the filter out entirely when there is no resizing to do', () => {
    const args = buildVideoResizeArgs(options({ mode: 'custom' }), PATHS);
    expect(args).not.toContain('-vf');
  });

  it('moves the slider onto the CRF the encoder wants', () => {
    const better = buildVideoResizeArgs(options({ quality: 100 }), PATHS);
    const worse = buildVideoResizeArgs(options({ quality: 0 }), PATHS);

    expect(better[better.indexOf('-crf') + 1]).toBe('16');
    expect(worse[worse.indexOf('-crf') + 1]).toBe('34');
  });
});

describe('resizedDimensions', () => {
  it('works the width out from a preset height', () => {
    expect(resizedDimensions(options({ mode: 'preset', preset: 720 }), source(1920, 1080))).toEqual(
      {
        width: 1280,
        height: 720,
      },
    );
  });

  it('works the missing side out from the one that was typed', () => {
    expect(resizedDimensions(options({ mode: 'custom', width: 640 }), source(1920, 1080))).toEqual({
      width: 640,
      height: 360,
    });
  });

  it('fits a landscape video inside a square box', () => {
    expect(
      resizedDimensions(options({ mode: 'custom', width: 512, height: 512 }), source(1920, 1080)),
    ).toEqual({ width: 512, height: 288 });
  });

  it('stretches to the box once the shape is unlocked', () => {
    expect(
      resizedDimensions(
        options({ mode: 'custom', width: 512, height: 512, keepAspect: false }),
        source(1920, 1080),
      ),
    ).toEqual({ width: 512, height: 512 });
  });

  it('says nothing until the dimensions of the file are known', () => {
    expect(resizedDimensions(options(), undefined)).toBeUndefined();
  });
});

describe('the resize descriptor', () => {
  it('warns when the target is bigger than the source', () => {
    const warnings = videoResize.preflight?.(options({ mode: 'preset', preset: 2160 }), {
      info: source(1280, 720),
    });
    expect(warnings?.[0]).toMatch(/bigger than the original/);
  });

  it('warns when the custom form has been left empty', () => {
    const warnings = videoResize.preflight?.(options({ mode: 'custom' }), {
      info: source(1920, 1080),
    });
    expect(warnings?.[0]).toMatch(/Fill in a width or a height/);
  });

  it('turns a file with no picture away', () => {
    expect(videoResize.rejects?.({ info: { ...source(0, 0), hasVideo: false } })).toMatch(
      /no picture/,
    );
  });

  it('names an optional field that its defaults declare as undefined', () => {
    // The registry's invariant: a key a field names must exist in defaults.
    expect(Object.keys(DEFAULT_RESIZE)).toContain('width');
    expect(DEFAULT_RESIZE.width).toBeUndefined();
  });
});
