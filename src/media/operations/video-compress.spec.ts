import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import { toShellCommand } from './descriptor';
import {
  buildVideoCompressionArgs,
  DEFAULT_COMPRESSION,
  estimateOutputBytes,
  qualityToCrf,
  videoBitrateBps,
  type VideoCompressionOptions,
} from './video-compress';
import { vp8CeilingKbps } from './vp8-output';

const info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  durationSeconds: 60,
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasVideo: true,
  hasAudio: true,
};

const context = { inputPath: '/mnt1/in.mp4', outputPath: '/out.mp4', info };

function options(overrides: Partial<VideoCompressionOptions> = {}): VideoCompressionOptions {
  return { ...DEFAULT_COMPRESSION, ...overrides };
}

/** Reads the value that follows a flag, the way FFmpeg does. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('qualityToCrf', () => {
  it('puts the default slider position on each codec’s usual default', () => {
    expect(qualityToCrf(60, 'h264')).toBe(23);
    expect(qualityToCrf(60, 'h265')).toBe(28);
    expect(qualityToCrf(60, 'vp8')).toBe(22);
  });

  it('runs the right way round: more quality is a lower CRF', () => {
    expect(qualityToCrf(100, 'h264')).toBe(16);
    expect(qualityToCrf(0, 'h264')).toBe(34);
  });

  it('clamps rather than extrapolating', () => {
    expect(qualityToCrf(140, 'h264')).toBe(16);
    expect(qualityToCrf(-20, 'h264')).toBe(34);
  });
});

describe('buildVideoCompressionArgs', () => {
  it('produces a plain, playable H.264 MP4 by default', () => {
    const args = buildVideoCompressionArgs(options(), context);
    expect(args.slice(0, 2)).toEqual(['-i', '/mnt1/in.mp4']);
    expect(valueAfter(args, '-c:v')).toBe('libx264');
    expect(valueAfter(args, '-preset')).toBe('veryfast');
    expect(valueAfter(args, '-crf')).toBe('23');
    expect(valueAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(valueAfter(args, '-c:a')).toBe('aac');
    expect(valueAfter(args, '-b:a')).toBe('128k');
    expect(valueAfter(args, '-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('never leaves a thread count in the command', () => {
    // -threads belongs to the core we happen to run on, not to the operation.
    expect(buildVideoCompressionArgs(options(), context)).not.toContain('-threads');
  });

  it('switches to Opus for WebM', () => {
    const args = buildVideoCompressionArgs(options({ format: 'webm', codec: 'vp8' }), context);
    expect(valueAfter(args, '-c:v')).toBe('libvpx');
    expect(valueAfter(args, '-c:a')).toBe('libopus');
    // VP8 treats the bitrate as a ceiling on its CRF, and needs one.
    expect(valueAfter(args, '-b:v')).toMatch(/^\d+k$/);
    expect(args).not.toContain('-movflags');
  });

  it('sizes the VP8 ceiling for the downscaled frame, not the source', () => {
    const args = buildVideoCompressionArgs(
      options({ format: 'webm', codec: 'vp8', maxHeight: 720 }),
      context,
    );
    expect(valueAfter(args, '-b:v')).toBe(
      `${vp8CeilingKbps({ width: 1280, height: 720, frameRate: 30 })}k`,
    );
  });

  it('tags H.265 so Apple players will open it', () => {
    const args = buildVideoCompressionArgs(options({ codec: 'h265' }), context);
    expect(valueAfter(args, '-c:v')).toBe('libx265');
    expect(valueAfter(args, '-tag:v')).toBe('hvc1');
  });

  it('takes longer when asked to', () => {
    expect(
      valueAfter(buildVideoCompressionArgs(options({ takeLonger: true }), context), '-preset'),
    ).toBe('medium');
  });

  it('drops the audio track on request', () => {
    const args = buildVideoCompressionArgs(options({ audio: 'none' }), context);
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
  });

  it('scales only downwards, and only to an even width', () => {
    expect(valueAfter(buildVideoCompressionArgs(options({ maxHeight: 720 }), context), '-vf')).toBe(
      'scale=-2:720',
    );
    // The source is already shorter than the cap, so there is nothing to do.
    expect(buildVideoCompressionArgs(options({ maxHeight: 2160 }), context)).not.toContain('-vf');
  });

  it('uses a bitrate with a ceiling when a size was asked for', () => {
    const args = buildVideoCompressionArgs(
      options({ mode: 'size', targetBytes: 25_000_000 }),
      context,
    );
    expect(args).not.toContain('-crf');
    expect(valueAfter(args, '-b:v')).toMatch(/^\d+k$/);
    expect(valueAfter(args, '-maxrate')).toMatch(/^\d+k$/);
    expect(valueAfter(args, '-bufsize')).toMatch(/^\d+k$/);
  });

  it('falls back to quality when the duration is unknown, rather than guessing a bitrate', () => {
    const args = buildVideoCompressionArgs(options({ mode: 'size', targetBytes: 25_000_000 }), {
      ...context,
      info: { source: 'native', kind: 'video' },
    });
    expect(valueAfter(args, '-crf')).toBe('23');
    expect(args).not.toContain('-b:v');
  });
});

describe('videoBitrateBps', () => {
  it('leaves room for the audio track', () => {
    const withAudio = videoBitrateBps(options({ targetBytes: 25_000_000, audio: 'high' }), info)!;
    const silent = videoBitrateBps(options({ targetBytes: 25_000_000, audio: 'none' }), info)!;
    expect(silent - withAudio).toBeCloseTo(192_000, -3);
  });

  it('fits inside the target: 25 MB over 60 s is about 3.3 Mbit/s', () => {
    const bps = videoBitrateBps(options({ targetBytes: 25_000_000, audio: 'none' }), info)!;
    expect(bps).toBeGreaterThan(3_000_000);
    expect(bps).toBeLessThan(3_300_000);
  });

  it('refuses to divide by a duration it does not have', () => {
    expect(videoBitrateBps(options({ targetBytes: 10_000_000 }), undefined)).toBeUndefined();
  });

  it('never returns a bitrate too small to encode', () => {
    expect(videoBitrateBps(options({ targetBytes: 1000, audio: 'none' }), info)).toBe(50_000);
  });
});

describe('estimateOutputBytes', () => {
  it('returns the target itself in size mode', () => {
    expect(estimateOutputBytes(options({ mode: 'size', targetBytes: 10_000_000 }), info)).toBe(
      10_000_000,
    );
  });

  it('gets within a sensible range for a known encode', () => {
    // 1080p30, CRF 23, one minute: a few hundred megabits, not a few gigabytes.
    const bytes = estimateOutputBytes(options(), info)!;
    expect(bytes).toBeGreaterThan(20_000_000);
    expect(bytes).toBeLessThan(70_000_000);
  });

  it('gets smaller as quality drops and as the picture shrinks', () => {
    const base = estimateOutputBytes(options(), info)!;
    expect(estimateOutputBytes(options({ quality: 30 }), info)!).toBeLessThan(base);
    expect(estimateOutputBytes(options({ maxHeight: 720 }), info)!).toBeLessThan(base);
    expect(estimateOutputBytes(options({ codec: 'h265' }), info)!).toBeLessThan(base);
  });

  it('never puts VP8 past its bitrate ceiling', () => {
    const webm = options({ format: 'webm', codec: 'vp8', quality: 95, audio: 'none' });
    const ceilingBytes = (vp8CeilingKbps(info) * 1000 * 60) / 8;
    expect(estimateOutputBytes(webm, info)).toBe(Math.round(ceilingBytes));
  });

  it('says nothing when it has nothing to go on', () => {
    expect(estimateOutputBytes(options(), { source: 'native', kind: 'video' })).toBeUndefined();
  });
});

describe('toShellCommand', () => {
  it('quotes what a shell would otherwise mangle', () => {
    const command = toShellCommand(['-i', 'my holiday.mp4', '-crf', '23', 'out.mp4']);
    expect(command).toBe(`ffmpeg -i 'my holiday.mp4' -crf 23 out.mp4`);
  });
});
