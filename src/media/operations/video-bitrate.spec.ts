import { describe, expect, it } from 'vitest';
import { buildVideoBitrateArgs, clampKbps, videoBitrate } from './video-bitrate';

describe('buildVideoBitrateArgs', () => {
  it('encodes at the bitrate asked for, with a ceiling, and copies the sound', () => {
    expect(
      buildVideoBitrateArgs({ kbps: 1000 }, { inputPath: 'in.mp4', outputPath: 'out.mp4' }),
    ).toEqual([
      '-i',
      'in.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-b:v',
      '1000k',
      '-maxrate',
      '1450k',
      '-bufsize',
      '2000k',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
  });
});

describe('clampKbps', () => {
  it('keeps the number inside what an encoder can sensibly do', () => {
    expect(clampKbps(10)).toBe(100);
    expect(clampKbps(90_000)).toBe(50_000);
    expect(clampKbps(undefined)).toBe(2500);
  });
});

describe('the bitrate descriptor', () => {
  const info = {
    source: 'ffprobe',
    kind: 'video',
    durationSeconds: 60,
    bitrate: 1_500_000,
  } as const;

  it('warns that more bits than the original will not help', () => {
    expect(videoBitrate.preflight?.({ kbps: 3000 }, { info })?.[0]).toMatch(/1500 kbps/);
    expect(videoBitrate.preflight?.({ kbps: 800 }, { info })).toEqual([]);
  });

  it('estimates from the bitrate asked for, plus the sound', () => {
    // (1000 + 128) kbit/s for a minute.
    expect(videoBitrate.estimateBytes?.({ kbps: 1000 }, { info })).toBe(8_460_000);
  });
});
