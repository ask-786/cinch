import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import {
  buildImagesVideoArgs,
  DEFAULT_SLIDES,
  imagesVideo,
  slideFilter,
  slideFrame,
  type ImagesVideoOptions,
} from './images-video';

const options = (overrides: Partial<ImagesVideoOptions> = {}): ImagesVideoOptions => ({
  ...DEFAULT_SLIDES,
  ...overrides,
});

const photo = (width: number, height: number): MediaInfo => ({
  source: 'native',
  kind: 'image',
  width,
  height,
});

describe('slideFrame', () => {
  it('takes its shape from the first picture, rounded to even sides', () => {
    expect(slideFrame(options(), photo(1001, 751))).toEqual({ width: 1002, height: 752 });
    expect(slideFrame(options({ size: '720' }), photo(4000, 3000))).toEqual({
      width: 960,
      height: 720,
    });
  });

  it('falls back to 720p while the first picture is still being read', () => {
    expect(slideFrame(options(), undefined)).toEqual({ width: 1280, height: 720 });
  });
});

describe('slideFilter', () => {
  it('fits every picture into the frame and plays them in order', () => {
    const graph = slideFilter(options({ size: '720' }), 2, photo(1280, 720));
    expect(graph).toBe(
      '[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];' +
        '[1:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v1];' +
        '[v0][v1]concat=n=2:v=1:a=0[v]',
    );
  });
});

describe('buildImagesVideoArgs', () => {
  it('turns each picture into a clip of its own length before reading it', () => {
    const args = buildImagesVideoArgs(
      options({ seconds: 5 }),
      { inputPaths: ['a.png', 'b.jpg'], outputPath: 'out.mp4' },
      photo(1280, 720),
    );
    expect(args.slice(0, 16)).toEqual([
      '-loop',
      '1',
      '-framerate',
      '30',
      '-t',
      '5',
      '-i',
      'a.png',
      '-loop',
      '1',
      '-framerate',
      '30',
      '-t',
      '5',
      '-i',
      'b.jpg',
    ]);
    expect(args).toContain('-an');
    expect(args.at(-1)).toBe('out.mp4');
  });
});

describe('imagesVideo', () => {
  const inputs = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      media: { id: String(index), name: `${index}.jpg`, kind: 'image' } as MediaFile,
      info: photo(1920, 1080),
    }));

  it('lasts as long as every picture put together', () => {
    expect(imagesVideo.outputDuration?.(options({ seconds: 2 }), { inputs: inputs(7) })).toBe(14);
  });

  it('gives an estimate, so the job can run on every core', () => {
    expect(imagesVideo.estimateBytes?.(options(), { inputs: inputs(3) })).toBeGreaterThan(0);
  });
});
