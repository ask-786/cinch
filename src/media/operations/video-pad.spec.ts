import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  alreadyFits,
  buildVideoPadArgs,
  DEFAULT_PAD,
  padFilter,
  paddedSize,
  videoPad,
  type VideoPadOptions,
} from './video-pad';

const options = (overrides: Partial<VideoPadOptions> = {}): VideoPadOptions => ({
  ...DEFAULT_PAD,
  ...overrides,
});

const sized = (width: number, height: number): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width,
  height,
});

describe('paddedSize', () => {
  it('grows the height of a landscape video to make it square', () => {
    expect(paddedSize(1280, 720, '1:1')).toEqual({ width: 1280, height: 1280 });
  });

  it('grows the width of a portrait video to make it widescreen', () => {
    expect(paddedSize(720, 1280, '16:9')).toEqual({ width: 2276, height: 1280 });
  });

  it('never shrinks either side', () => {
    const size = paddedSize(1280, 720, '9:16');
    expect(size.width).toBe(1280);
    expect(size.height).toBeGreaterThan(720);
  });

  it('lands on even numbers', () => {
    const size = paddedSize(641, 479, '4:5');
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});

describe('padFilter', () => {
  it('pads with a flat colour, centred', () => {
    expect(padFilter(options({ background: 'black' }), sized(1280, 720))).toBe(
      'pad=1280:1280:x=(ow-iw)/2:y=(oh-ih)/2:color=black',
    );
  });

  it('puts the video over a blurred, enlarged copy of itself', () => {
    const filter = padFilter(options({ background: 'blur' }), sized(1280, 720));
    expect(filter).toContain('split[bg][fg]');
    // Blurred at a quarter of the size, then scaled back up.
    expect(filter).toContain(
      'scale=320:320:force_original_aspect_ratio=increase,crop=320:320,boxblur=16:2,scale=1280:1280',
    );
    expect(filter).toContain('[blurred][fg]overlay=(W-w)/2:(H-h)/2');
  });

  it('lets FFmpeg work the size out while it is still being read', () => {
    expect(padFilter(options({ ratio: '16:9' }), undefined)).toBe(
      "pad=w='max(iw,ceil(ih*16/9/2)*2)':h='max(ih,ceil(iw*9/16/2)*2)':x=(ow-iw)/2:y=(oh-ih)/2:color=black",
    );
  });
});

describe('buildVideoPadArgs', () => {
  it('filters the picture and copies the sound', () => {
    const args = buildVideoPadArgs(
      options({ background: 'white' }),
      { inputPath: 'in.mp4', outputPath: 'out.mp4' },
      sized(1280, 720),
    );
    expect(args.slice(0, 4)).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      'pad=1280:1280:x=(ow-iw)/2:y=(oh-ih)/2:color=white',
    ]);
    expect(args).toContain('copy');
  });
});

describe('the pad descriptor', () => {
  it('warns when the video is already that shape', () => {
    expect(alreadyFits(sized(1920, 1080), '16:9')).toBe(true);
    expect(
      videoPad.preflight?.(options({ ratio: '16:9' }), { info: sized(1920, 1080) })?.[0],
    ).toMatch(/already 16:9/);
    expect(videoPad.preflight?.(options(), { info: sized(1920, 1080) })).toEqual([]);
  });

  it('says the bars will be black until the size is known', () => {
    expect(videoPad.preflight?.(options({ background: 'blur' }), {})?.[0]).toMatch(/black/);
  });
});
