import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoConvertArgs,
  canCopyAudio,
  canCopyVideo,
  convertCrf,
  DEFAULT_CONVERT,
  videoConvert,
  type VideoConvertOptions,
} from './video-convert';

const paths = { inputPath: '/mnt1/in.mkv', outputPath: '/out.mp4' };

function options(overrides: Partial<VideoConvertOptions> = {}): VideoConvertOptions {
  return { ...DEFAULT_CONVERT, ...overrides };
}

const h264Info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  videoCodec: 'h264',
  audioCodec: 'aac',
  durationSeconds: 30,
};

describe('buildVideoConvertArgs', () => {
  it('copies both streams by default, which is the whole point of a rewrap', () => {
    const args = buildVideoConvertArgs(options(), paths);
    expect(args).toEqual([
      '-i',
      '/mnt1/in.mkv',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '/out.mp4',
    ]);
  });

  it('tags H.265 as hvc1 so QuickTime and Safari will open it', () => {
    const args = buildVideoConvertArgs(options({ video: 'h265' }), paths);
    expect(args).toContain('-tag:v');
    expect(args[args.indexOf('-tag:v') + 1]).toBe('hvc1');
  });

  it('encodes WebM as VP8, with the bitrate ceiling its CRF needs', () => {
    const args = buildVideoConvertArgs(
      options({ format: 'webm', video: 'vp8', audio: 'opus' }),
      paths,
      { source: 'ffprobe', kind: 'video', width: 1280, height: 720, frameRate: 30 },
    );
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx');
    expect(args[args.indexOf('-b:v') + 1]).toBe('1935k');
    expect(args).not.toContain('libvpx-vp9');
    expect(args).not.toContain('-movflags');
  });

  it('drops the audio when asked', () => {
    expect(buildVideoConvertArgs(options({ audio: 'none' }), paths)).toContain('-an');
  });
});

describe('convertCrf', () => {
  it('runs backwards, because CRF does', () => {
    expect(convertCrf(0, 'h264')).toBe(34);
    expect(convertCrf(100, 'h264')).toBe(16);
  });
});

describe('stream copying', () => {
  it('knows which codecs a container will hold', () => {
    expect(canCopyVideo('mp4', h264Info)).toBe(true);
    expect(canCopyVideo('webm', h264Info)).toBe(false);
    expect(canCopyAudio('webm', h264Info)).toBe(false);
    expect(canCopyAudio('mp4', h264Info)).toBe(true);
  });

  it('offers the copy when the source codec is unknown, rather than guessing it away', () => {
    expect(canCopyVideo('webm', undefined)).toBe(true);
  });
});

describe('the convert descriptor', () => {
  const normalize = (values: VideoConvertOptions, info?: MediaInfo) =>
    videoConvert.normalize?.(values, { info }) as unknown as VideoConvertOptions;

  it('re-encodes when the chosen container cannot copy the source', () => {
    const next = normalize(options({ format: 'webm' }), h264Info);
    expect(next.video).toBe('vp8');
    expect(next.audio).toBe('opus');
  });

  it('leaves a copy alone when the container can hold it', () => {
    const next = normalize(options({ format: 'mkv' }), h264Info);
    expect(next.video).toBe('copy');
    expect(next.audio).toBe('copy');
  });

  it('says plainly when a job is only a rewrap', () => {
    const warnings = videoConvert.preflight?.(options() as never, { info: h264Info }) ?? [];
    expect(warnings.join(' ')).toMatch(/rewraps/i);
  });

  it('only claims to know the output size when both streams are copied', () => {
    const media = { size: 1234 } as never;
    expect(videoConvert.estimateBytes?.(options() as never, { media })).toBe(1234);
    expect(
      videoConvert.estimateBytes?.(options({ video: 'h264' }) as never, { media }),
    ).toBeUndefined();
  });
});
