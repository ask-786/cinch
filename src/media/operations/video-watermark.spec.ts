import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';
import type { OperationInput } from './descriptor';
import {
  buildVideoWatermarkArgs,
  DEFAULT_WATERMARK,
  videoWatermark,
  watermarkFilter,
  watermarkPlacement,
  watermarkRoles,
  type VideoWatermarkOptions,
} from './video-watermark';

const options = (overrides: Partial<VideoWatermarkOptions> = {}): VideoWatermarkOptions => ({
  ...DEFAULT_WATERMARK,
  ...overrides,
});

function input(name: string, kind: MediaKind, info: Partial<MediaInfo> = {}): OperationInput {
  return {
    media: { id: name, name, kind } as MediaFile,
    info: { source: 'ffprobe', kind, ...info },
  };
}

const clip = input('talk.mp4', 'video', {
  width: 1920,
  height: 1080,
  hasVideo: true,
  durationSeconds: 30,
  bitrate: 4_000_000,
});
const logo = input('logo.png', 'image', { width: 400, height: 200 });

describe('watermarkRoles', () => {
  it('finds the video and the picture in either order', () => {
    expect(watermarkRoles(['video', 'image'])).toEqual({ video: 0, logo: 1 });
    expect(watermarkRoles(['image', 'video'])).toEqual({ video: 1, logo: 0 });
  });
});

describe('watermarkPlacement', () => {
  it('keeps the logo a margin away from the chosen corner', () => {
    expect(watermarkPlacement('top-left', 20)).toEqual({ x: '20', y: '20' });
    expect(watermarkPlacement('bottom-right', 20)).toEqual({ x: 'W-w-20', y: 'H-h-20' });
    expect(watermarkPlacement('top-right', 20)).toEqual({ x: 'W-w-20', y: '20' });
  });

  it('centres it without a margin', () => {
    expect(watermarkPlacement('center', 20)).toEqual({ x: '(W-w)/2', y: '(H-h)/2' });
  });
});

describe('watermarkFilter', () => {
  it("sizes the logo against the video's width and fades it", () => {
    expect(watermarkFilter(options(), { video: 0, logo: 1 }, clip.info)).toBe(
      '[1:v:0]scale=288:-1,format=rgba,colorchannelmixer=aa=0.80[logo];' +
        '[0:v:0][logo]overlay=W-w-58:H-h-58,format=yuv420p[v]',
    );
  });
});

describe('buildVideoWatermarkArgs', () => {
  it('keeps the sound of the video, if it has any', () => {
    const args = buildVideoWatermarkArgs(
      options(),
      { inputPaths: ['logo.png', 'talk.mp4'], outputPath: 'out.mp4' },
      [logo, clip],
    );
    expect(args.slice(0, 4)).toEqual(['-i', 'logo.png', '-i', 'talk.mp4']);
    expect(args.join(' ')).toContain('-map [v] -map 1:a:0? -c:v libx264');
    expect(args).toContain('copy');
    expect(args.at(-1)).toBe('out.mp4');
  });
});

describe('videoWatermark', () => {
  it('takes one video and one picture, and nothing else', () => {
    const other = input('other.mp4', 'video');
    expect(videoWatermark.rejects?.({ inputs: [clip, other] })).toMatch(
      /one video and one picture/,
    );
    expect(videoWatermark.rejects?.({ inputs: [logo, clip] })).toBeUndefined();
  });

  it('estimates from the video, whichever order the files are in', () => {
    expect(videoWatermark.estimateBytes?.(options(), { inputs: [logo, clip] })).toBe(15_000_000);
    expect(videoWatermark.outputDuration?.(options(), { inputs: [logo, clip] })).toBe(30);
  });
});
