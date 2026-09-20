import { describe, expect, it } from 'vitest';
import { ffprobeArgs, parseFfprobe, parseFrameRate } from './ffprobe';

describe('ffprobeArgs', () => {
  it('asks for JSON on a file rather than on stderr', () => {
    const args = ffprobeArgs('/mnt1/clip.mp4', '/probe.json');
    expect(args).toContain('-print_format');
    expect(args).toContain('json');
    expect(args.slice(-2)).toEqual(['-o', '/probe.json']);
  });
});

describe('parseFrameRate', () => {
  it('reduces the fractions ffprobe reports', () => {
    expect(parseFrameRate('30000/1001')).toBe(29.97);
    expect(parseFrameRate('25/1')).toBe(25);
    expect(parseFrameRate('60')).toBe(60);
  });

  it('rejects the placeholders it uses for still images and audio', () => {
    expect(parseFrameRate('0/0')).toBeUndefined();
    expect(parseFrameRate('90000/0')).toBeUndefined();
    expect(parseFrameRate(undefined)).toBeUndefined();
  });
});

describe('parseFfprobe', () => {
  const payload = JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
        duration: '61.5',
      },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
    format: { duration: '61.541000', bit_rate: '2500000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  });

  it('reads both streams and the container', () => {
    const info = parseFfprobe(payload, 'video');
    expect(info).toMatchObject({
      source: 'ffprobe',
      kind: 'video',
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 29.97,
      bitrate: 2_500_000,
      sampleRate: 48_000,
      channels: 2,
      hasVideo: true,
      hasAudio: true,
    });
    expect(info?.durationSeconds).toBeCloseTo(61.541);
  });

  it('notices a video with no audio track', () => {
    const silent = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'vp9', width: 640, height: 360 }],
      format: { duration: '3.0' },
    });
    const info = parseFfprobe(silent, 'video');
    expect(info?.hasAudio).toBe(false);
    expect(info?.audioCodec).toBeUndefined();
  });

  it('gives up rather than guessing', () => {
    expect(parseFfprobe('not json', 'video')).toBeUndefined();
    expect(parseFfprobe('{}', 'video')).toBeUndefined();
  });
});
