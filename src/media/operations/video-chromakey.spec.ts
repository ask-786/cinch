import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaKind } from '../models/media-kind';
import type { OperationInput } from './descriptor';
import {
  buildVideoChromakeyArgs,
  chromakeyRoles,
  DEFAULT_CHROMAKEY,
  alphaVideoKbps,
  keyFilter,
  videoChromakey,
  vp8Crf,
} from './video-chromakey';

const input = (kind: MediaKind, name: string, extra = {}): OperationInput => ({
  media: { kind, name } as MediaFile,
  info: { source: 'ffprobe', kind, ...extra },
});

const VIDEO = input('video', 'clip.mp4', { width: 1920, height: 1080, frameRate: 29.97 });
const PICTURE = input('image', 'beach.jpg');

describe('chromakeyRoles', () => {
  it('finds the background picture in either position', () => {
    expect(chromakeyRoles(['video', 'image'])).toEqual({ video: 0, background: 1 });
    expect(chromakeyRoles(['image', 'video'])).toEqual({ video: 1, background: 0 });
  });

  it('has no background with one file', () => {
    expect(chromakeyRoles(['video'])).toEqual({ video: 0 });
  });
});

describe('keyFilter', () => {
  it('keys the broadcast green with the chosen strength and softness', () => {
    expect(keyFilter(DEFAULT_CHROMAKEY)).toBe('chromakey=0x00B140:0.20:0.05');
    expect(keyFilter({ ...DEFAULT_CHROMAKEY, color: 'blue', strength: 35, softness: 0 })).toBe(
      'chromakey=0x0047BB:0.35:0.00',
    );
  });
});

describe('vp8Crf', () => {
  it('runs from worst at 0 to best at 100', () => {
    expect(vp8Crf(0)).toBe(40);
    expect(vp8Crf(100)).toBe(10);
  });
});

describe('alphaVideoKbps', () => {
  it('grows with the frame size and rate', () => {
    expect(
      alphaVideoKbps({ source: 'ffprobe', kind: 'video', width: 1280, height: 720, frameRate: 30 }),
    ).toBe(1935);
    expect(alphaVideoKbps(VIDEO.info)).toBeGreaterThan(1935);
  });

  it('assumes 720p30 while the size is still being read', () => {
    expect(alphaVideoKbps(undefined)).toBe(1935);
  });
});

describe('buildVideoChromakeyArgs', () => {
  it('writes a transparent WebM when there is no background', () => {
    const args = buildVideoChromakeyArgs(
      DEFAULT_CHROMAKEY,
      { inputPaths: ['clip.mp4'], outputPath: 'out.webm' },
      [VIDEO],
    );
    expect(args.slice(0, 4)).toEqual(['-i', 'clip.mp4', '-vf', 'chromakey=0x00B140:0.20:0.05']);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuva420p');
    expect(args[args.indexOf('-auto-alt-ref') + 1]).toBe('0');
    expect(args.at(-1)).toBe('out.webm');
  });

  it('caps the transparent video’s bitrate by its frame size', () => {
    const args = buildVideoChromakeyArgs(
      DEFAULT_CHROMAKEY,
      { inputPaths: ['clip.mp4'], outputPath: 'out.webm' },
      [VIDEO],
    );
    expect(args[args.indexOf('-crf') + 1]).toBe(String(vp8Crf(DEFAULT_CHROMAKEY.quality)));
    expect(args[args.indexOf('-b:v') + 1]).toBe(`${alphaVideoKbps(VIDEO.info)}k`);
  });

  it('loops the picture at the video’s own frame rate, behind the keyed video', () => {
    const args = buildVideoChromakeyArgs(
      DEFAULT_CHROMAKEY,
      { inputPaths: ['beach.jpg', 'clip.mp4'], outputPath: 'out.mp4' },
      [PICTURE, VIDEO],
    );
    expect(args.slice(0, 8)).toEqual([
      '-loop',
      '1',
      '-framerate',
      '29.97',
      '-i',
      'beach.jpg',
      '-i',
      'clip.mp4',
    ]);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toBe(
      '[0:v:0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[bg];' +
        '[1:v:0]chromakey=0x00B140:0.20:0.05[fg];' +
        '[bg][fg]overlay=shortest=1,format=yuv420p[v]',
    );
    expect(args).toContain('1:a:0?');
    expect(args).toContain('libx264');
  });
});

describe('the chromakey descriptor', () => {
  it('writes WebM alone and MP4 with a background', () => {
    expect(videoChromakey.outputExtension(DEFAULT_CHROMAKEY, { inputs: [VIDEO] })).toBe('webm');
    expect(videoChromakey.outputExtension(DEFAULT_CHROMAKEY, { inputs: [VIDEO, PICTURE] })).toBe(
      'mp4',
    );
  });

  it('estimates the transparent WebM from its bitrate cap, alpha stream included', () => {
    const clip = input('video', 'clip.mp4', {
      ...VIDEO.info,
      durationSeconds: 10,
      bitrate: 8_000_000,
    });
    const kbps = 2 * alphaVideoKbps(clip.info) + 128;
    expect(videoChromakey.estimateBytes?.(DEFAULT_CHROMAKEY, { inputs: [clip] })).toBe(
      Math.round((kbps * 1000 * 10) / 8),
    );
    expect(videoChromakey.estimateBytes?.(DEFAULT_CHROMAKEY, { inputs: [clip, PICTURE] })).toBe(
      10_000_000,
    );
  });

  it('turns away two videos', () => {
    expect(videoChromakey.rejects?.({ inputs: [VIDEO, VIDEO] })).toMatch(/one video/);
    expect(videoChromakey.rejects?.({ inputs: [VIDEO, PICTURE] })).toBeUndefined();
  });

  it('explains the transparent output when there is no picture', () => {
    expect(videoChromakey.preflight?.(DEFAULT_CHROMAKEY, { inputs: [VIDEO] })?.[0]).toMatch(
      /transparent/,
    );
  });
});
