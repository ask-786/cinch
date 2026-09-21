import type { MediaInfo } from '../models/media-info';
import { defineOperation } from './descriptor';

/**
 * Save still pictures out of a video, one every few seconds.
 *
 * The first operation that writes many files: the output path carries the
 * sequence token and FFmpeg's image2 muxer numbers the frames itself. Every
 * frame sits in memory until the job finishes, so the count is the thing to
 * watch — a frame a second of a long 4K video is gigabytes of PNG.
 */

export type FrameFormat = 'jpg' | 'png';
export type FrameWidth = 'original' | '1920' | '1280' | '640';

export type VideoFramesOptions = {
  /** Seconds between frames. */
  readonly every: number;
  readonly format: FrameFormat;
  readonly width: FrameWidth;
};

export const DEFAULT_FRAMES: VideoFramesOptions = {
  every: 5,
  format: 'jpg',
  width: 'original',
};

/** Above this many frames the result starts to crowd the memory ceiling. */
export const MANY_FRAMES = 500;

/**
 * Rough bytes per pixel, measured loosely on camera footage: a JPEG at
 * `-q:v 2` and a PNG of the same frame. Good enough for a line under a form.
 */
const BYTES_PER_PIXEL: Readonly<Record<FrameFormat, number>> = { jpg: 0.2, png: 1.5 };

export function frameCount(options: VideoFramesOptions, durationSeconds: number): number {
  // The first frame, then one per interval.
  return Math.floor(durationSeconds / options.every) + 1;
}

/**
 * Picks real frames by their timestamps: the first one, then each one at least
 * `every` seconds after the last pick. The `fps` filter looks like the obvious
 * tool, but in the core's FFmpeg 5.1 it drops the final pick — two frames out
 * of a 12 s clip at every 5 s, where this gives 0, 5 and 10.
 */
export function frameFilter(options: VideoFramesOptions): string {
  const steps = [`select='isnan(prev_selected_t)+gte(t-prev_selected_t,${options.every})'`];
  // -2 keeps the aspect ratio and lands on an even height.
  if (options.width !== 'original') steps.push(`scale='min(${options.width},iw)':-2`);
  return steps.join(',');
}

export function buildVideoFramesArgs(
  options: VideoFramesOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  // vfr: write only the picked frames, rather than repeating them to fill time.
  const args = ['-i', paths.inputPath, '-vf', frameFilter(options), '-fps_mode', 'vfr', '-an'];
  // 2 is near the top of JPEG's 2–31 scale; the default is visibly blocky.
  if (options.format === 'jpg') args.push('-q:v', '2');
  args.push('-f', 'image2', paths.outputPath);
  return args;
}

function outputPixels(
  options: VideoFramesOptions,
  info: MediaInfo | undefined,
): number | undefined {
  if (!info?.width || !info?.height) return undefined;
  if (options.width === 'original') return info.width * info.height;
  const width = Math.min(Number(options.width), info.width);
  return width * Math.round((width * info.height) / info.width);
}

export const videoFrames = defineOperation<VideoFramesOptions>({
  id: 'video-frames',
  route: 'frames',
  title: 'Extract frames',
  verb: 'Extract frames',
  summary: 'Save still pictures from a video, one every few seconds.',
  group: 'image',
  accepts: ['video'],
  outputs: 'many',
  defaults: DEFAULT_FRAMES,
  outputSuffix: 'frame',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to take frames from.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'every',
      label: 'One picture every',
      choices: [
        { value: 1, label: 'second' },
        { value: 5, label: '5 seconds' },
        { value: 10, label: '10 seconds' },
        { value: 30, label: '30 seconds' },
        { value: 60, label: 'minute' },
      ],
    },
    {
      kind: 'segmented',
      key: 'format',
      label: 'Format',
      choices: [
        { value: 'jpg', label: 'JPG', note: 'small' },
        { value: 'png', label: 'PNG', note: 'lossless' },
      ],
    },
    {
      kind: 'select',
      key: 'width',
      label: 'Width',
      choices: [
        { value: 'original', label: 'As recorded' },
        { value: '1920', label: 'Up to 1920 px' },
        { value: '1280', label: 'Up to 1280 px' },
        { value: '640', label: 'Up to 640 px' },
      ],
    },
  ],

  preflight: (options, context) => {
    const duration = context.info?.durationSeconds;
    if (duration === undefined) return ['The length of this file is still being read.'];
    const count = frameCount(options, duration);
    return count > MANY_FRAMES
      ? [
          `That is about ${count} pictures, which all have to fit in memory at once. Space them further apart, or make them smaller.`,
        ]
      : [];
  },

  build: (options, paths) => buildVideoFramesArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => (options.format === 'png' ? 'image/png' : 'image/jpeg'),

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    const pixels = outputPixels(options, context.info);
    if (duration === undefined || pixels === undefined) return undefined;
    return Math.round(frameCount(options, duration) * pixels * BYTES_PER_PIXEL[options.format]);
  },
});
