import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import type { OperationContext } from './descriptor';
import {
  buildVideoCropArgs,
  cropFilter,
  DEFAULT_CROP,
  videoCrop,
  type VideoCropOptions,
} from './video-crop';

const frame = (width: number, height: number, overrides: Partial<MediaInfo> = {}) =>
  ({
    info: {
      source: 'ffprobe',
      kind: 'video',
      hasVideo: true,
      width,
      height,
      durationSeconds: 10,
      ...overrides,
    },
  }) satisfies OperationContext;

const normalize = (changes: Partial<VideoCropOptions>, context: OperationContext) =>
  videoCrop.normalize!({ ...DEFAULT_CROP, ...changes }, context) as VideoCropOptions;

describe('cropFilter', () => {
  it('cuts the box it is given', () => {
    expect(cropFilter({ ...DEFAULT_CROP, width: 720, height: 720, x: 280, y: 0 })).toBe(
      'crop=720:720:280:0',
    );
  });

  it('works the box out itself while the size of the picture is unknown', () => {
    expect(cropFilter(DEFAULT_CROP)).toBe('crop=iw:ih:(iw-ow)/2:(ih-oh)/2');
    expect(cropFilter({ ...DEFAULT_CROP, aspect: '1:1' })).toBe(
      'crop=min(iw\\,ih*1/1):min(ih\\,iw*1/1):(iw-ow)/2:(ih-oh)/2',
    );
  });
});

describe('buildVideoCropArgs', () => {
  it('crops, writes H.264 and copies the sound', () => {
    const args = buildVideoCropArgs(
      { ...DEFAULT_CROP, width: 720, height: 720, x: 280, y: 0 },
      { inputPath: 'in.mov', outputPath: 'out.mp4' },
    );
    expect(args.slice(0, 4)).toEqual(['-i', 'in.mov', '-vf', 'crop=720:720:280:0']);
    expect(args).toContain('libx264');
    expect(args.join(' ')).toContain('-c:a copy');
    expect(args.at(-1)).toBe('out.mp4');
  });
});

describe('videoCrop.normalize', () => {
  it('starts from the whole picture', () => {
    expect(normalize({}, frame(1920, 1080))).toMatchObject({
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
    });
  });

  it('leaves the options alone until it knows the size of the picture', () => {
    expect(normalize({}, {})).toEqual(DEFAULT_CROP);
    expect(normalize({}, { info: { source: 'native', kind: 'video' } })).toEqual(DEFAULT_CROP);
  });

  it('fits the biggest box of a new shape in the middle', () => {
    expect(normalize({ aspect: '1:1' }, frame(1920, 1080))).toMatchObject({
      width: 1080,
      height: 1080,
      x: 420,
      y: 0,
    });
    expect(normalize({ aspect: '9:16' }, frame(1920, 1080))).toMatchObject({
      width: 606,
      height: 1078,
      x: 656,
      y: 0,
    });
  });

  it('refits when the shape changes, even after the box was moved', () => {
    const square = normalize({ aspect: '1:1', x: 0 }, frame(1920, 1080));
    const wide = normalize({ ...square, aspect: '16:9' }, frame(1920, 1080));
    expect(wide).toMatchObject({ width: 1920, height: 1080, x: 0, y: 0 });
  });

  it('keeps a fixed shape while the width changes, with the height following', () => {
    const square = normalize({ aspect: '1:1' }, frame(1920, 1080));
    expect(normalize({ ...square, width: 500 }, frame(1920, 1080))).toMatchObject({
      width: 500,
      height: 500,
    });
    // Wider than the picture is tall: the height binds and the width shrinks to match.
    expect(normalize({ ...square, width: 1500 }, frame(1920, 1080))).toMatchObject({
      width: 1080,
      height: 1080,
    });
  });

  it('keeps the box inside the picture and on even numbers', () => {
    const free = normalize({}, frame(1920, 1080));
    expect(
      normalize({ ...free, width: 3000, height: 101, x: 5000, y: -7 }, frame(1920, 1080)),
    ).toMatchObject({ width: 1920, height: 100, x: 0, y: 0 });
    expect(
      normalize({ ...free, width: 401, height: 301, x: 1801, y: 999 }, frame(1920, 1080)),
    ).toMatchObject({ width: 400, height: 300, x: 1520, y: 780 });
  });

  it('measures a phone video the right way up', () => {
    expect(normalize({ aspect: '1:1' }, frame(1920, 1080, { rotation: 90 }))).toMatchObject({
      width: 1080,
      height: 1080,
      x: 0,
      y: 420,
    });
  });

  it('starts over on a different file rather than squeezing in the old box', () => {
    const wide = normalize({}, frame(1920, 1080));
    expect(normalize(wide, frame(1080, 1920))).toMatchObject({
      width: 1080,
      height: 1920,
      x: 0,
      y: 0,
    });
    const square = normalize({ aspect: '1:1', x: 0 }, frame(1920, 1080));
    expect(normalize(square, frame(1080, 1920))).toMatchObject({
      width: 1080,
      height: 1080,
      x: 0,
      y: 420,
    });
  });

  it('leaves a picture too small to crop alone', () => {
    expect(normalize({}, frame(1, 1))).toEqual(DEFAULT_CROP);
  });

  it('settles: normalizing twice changes nothing', () => {
    for (const aspect of ['free', 'original', '1:1', '16:9', '9:16', '4:5', '4:3'] as const) {
      const once = normalize({ aspect }, frame(1280, 720));
      expect(normalize(once, frame(1280, 720))).toEqual(once);
    }
  });
});

describe('videoCrop', () => {
  it('holds the run back, without a warning, until the box cuts something away', () => {
    const whole = normalize({}, frame(1920, 1080));
    expect(videoCrop.preflight?.(whole, frame(1920, 1080))).toEqual([]);
    expect(videoCrop.incomplete?.(whole, frame(1920, 1080))).toMatch(/Pick a shape/);
    const square = normalize({ aspect: '1:1' }, frame(1920, 1080));
    expect(videoCrop.incomplete?.(square, frame(1920, 1080))).toBeUndefined();
  });

  it('turns away a file with no picture', () => {
    expect(videoCrop.rejects?.(frame(0, 0, { hasVideo: false }))).toMatch(/no picture/);
  });

  it('estimates a smaller box as a smaller file', () => {
    const context = frame(1920, 1080, { frameRate: 30 });
    const whole = videoCrop.estimateBytes!(normalize({}, context), context)!;
    const square = videoCrop.estimateBytes!(normalize({ aspect: '1:1' }, context), context)!;
    expect(square).toBeLessThan(whole);
  });

  it('does not estimate a lean source at many times its own size', () => {
    const context = frame(1280, 720, { bitrate: 200_000 });
    const square = normalize({ aspect: '1:1' }, context);
    // 10 s at 200 kbps is 250 kB, and a square keeps 56% of the picture.
    expect(videoCrop.estimateBytes?.(square, context)).toBe(140_625);
  });
});
