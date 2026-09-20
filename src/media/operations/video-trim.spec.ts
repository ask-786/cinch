import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoTrimArgs,
  DEFAULT_TRIM,
  trimDuration,
  videoTrim,
  type VideoTrimOptions,
} from './video-trim';

const paths = { inputPath: '/mnt1/in.mp4', outputPath: '/out.mp4' };

function options(overrides: Partial<VideoTrimOptions> = {}): VideoTrimOptions {
  return { ...DEFAULT_TRIM, ...overrides };
}

const info: MediaInfo = { source: 'ffprobe', kind: 'video', durationSeconds: 60 };

describe('buildVideoTrimArgs', () => {
  it('seeks before the input, which is the fast form', () => {
    const args = buildVideoTrimArgs(options({ startSeconds: 10, endSeconds: 20 }), paths, 'mp4');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('00:00:10.000');
  });

  it('asks for a duration, not an end time', () => {
    const args = buildVideoTrimArgs(options({ startSeconds: 10, endSeconds: 25 }), paths, 'mp4');
    expect(args[args.indexOf('-t') + 1]).toBe('00:00:15.000');
  });

  it('copies the streams by default, and zeroes the timestamps after the seek', () => {
    const args = buildVideoTrimArgs(options({ startSeconds: 5, endSeconds: 10 }), paths, 'mp4');
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args).toContain('-avoid_negative_ts');
  });

  it('re-encodes when the cut has to be exact', () => {
    const args = buildVideoTrimArgs(
      options({ startSeconds: 5, endSeconds: 10, exact: true }),
      paths,
      'mp4',
    );
    expect(args).toContain('libx264');
    expect(args).not.toContain('copy');
  });

  it('leaves out the duration when there is nothing to keep', () => {
    expect(buildVideoTrimArgs(options(), paths, 'mp4')).not.toContain('-t');
  });
});

describe('the trim descriptor', () => {
  const normalize = (values: VideoTrimOptions, probed?: MediaInfo) =>
    videoTrim.normalize?.(values, { info: probed }) as unknown as VideoTrimOptions;

  it('opens with the whole file selected once the duration is known', () => {
    expect(normalize(DEFAULT_TRIM, info)).toEqual({
      startSeconds: 0,
      endSeconds: 60,
      exact: false,
    });
  });

  it('keeps the handles inside the file and in order', () => {
    expect(normalize(options({ startSeconds: 90, endSeconds: 120 }), info).endSeconds).toBe(60);
    const crossed = normalize(options({ startSeconds: 40, endSeconds: 10 }), info);
    expect(crossed.startSeconds).toBeLessThan(crossed.endSeconds);
  });

  it('keeps the source container when copying, and moves to MP4 when re-encoding', () => {
    const media = { extension: 'mkv' } as never;
    expect(videoTrim.outputExtension(options() as never, { media })).toBe('mkv');
    expect(videoTrim.outputExtension(options({ exact: true }) as never, { media })).toBe('mp4');
  });

  it('says out loud that a copy cuts on a keyframe', () => {
    const warnings =
      videoTrim.preflight?.(options({ startSeconds: 0, endSeconds: 10 }) as never, { info }) ?? [];
    expect(warnings.join(' ')).toMatch(/keyframe/i);
  });

  it('reports the clip’s own length, which is what progress is measured against', () => {
    expect(
      videoTrim.outputDuration?.(options({ startSeconds: 10, endSeconds: 25 }) as never, {}),
    ).toBe(15);
    expect(trimDuration(options({ startSeconds: 25, endSeconds: 10 }))).toBe(0);
  });
});
