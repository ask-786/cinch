import { describe, expect, it } from 'vitest';
import {
  buildVideoDeinterlaceArgs,
  DEFAULT_DEINTERLACE,
  deinterlaceFilter,
  videoDeinterlace,
} from './video-deinterlace';

describe('deinterlaceFilter', () => {
  it('keeps the frame rate by default and treats every frame as interlaced', () => {
    expect(deinterlaceFilter(DEFAULT_DEINTERLACE)).toBe('bwdif=mode=send_frame:deint=all');
  });

  it('sends each field as its own frame for smoother motion', () => {
    expect(deinterlaceFilter({ ...DEFAULT_DEINTERLACE, rate: 'double' })).toBe(
      'bwdif=mode=send_field:deint=all',
    );
  });
});

describe('buildVideoDeinterlaceArgs', () => {
  it('filters the picture and copies the sound', () => {
    const args = buildVideoDeinterlaceArgs(DEFAULT_DEINTERLACE, {
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
    });
    expect(args.slice(0, 4)).toEqual(['-i', 'in.mp4', '-vf', 'bwdif=mode=send_frame:deint=all']);
    expect(args).toContain('copy');
    expect(args.at(-1)).toBe('out.mp4');
  });
});

describe('the deinterlace descriptor', () => {
  it('expects a bigger file at double the frame rate', () => {
    const info = {
      source: 'ffprobe',
      kind: 'video',
      durationSeconds: 10,
      bitrate: 800_000,
    } as const;
    const same = videoDeinterlace.estimateBytes?.(DEFAULT_DEINTERLACE, { info }) ?? 0;
    const double =
      videoDeinterlace.estimateBytes?.({ ...DEFAULT_DEINTERLACE, rate: 'double' }, { info }) ?? 0;
    expect(same).toBe(1_000_000);
    expect(double).toBeGreaterThan(same);
  });
});
