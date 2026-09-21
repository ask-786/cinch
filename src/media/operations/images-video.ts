import type { MediaInfo } from '../models/media-info';
import { defineOperation, type OperationContext } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { DEFAULT_COMPRESSION, estimateOutputBytes, qualityToCrf } from './video-compress';

/**
 * Turn pictures into a video that shows each one for a few seconds — a
 * slideshow, or a single still to put music under.
 *
 * Every picture becomes a short clip of its own (`-loop 1` for its seconds),
 * fitted into one frame with black bars the way join does it, and the clips
 * are then played one after another.
 */

export type SlideSize = 'first' | '1080' | '720';

export type ImagesVideoOptions = {
  /** Seconds each picture stays on screen. */
  readonly seconds: number;
  readonly size: SlideSize;
  readonly quality: number;
};

export const DEFAULT_SLIDES: ImagesVideoOptions = {
  seconds: 3,
  size: 'first',
  quality: 60,
};

/** Smooth enough for a still, and what every player expects. */
const FRAME_RATE = 30;
const FALLBACK = { width: 1280, height: 720 };

/**
 * A still barely changes from one frame to the next, so H.264 spends far less
 * on it than on footage. Test patterns at the default quality came out at
 * about a twentieth; a tenth leaves room for detailed photos.
 */
const STILL_FACTOR = 0.1;

/** The frame every picture is fitted into. Even: H.264 with 4:2:0 insists. */
export function slideFrame(
  options: ImagesVideoOptions,
  first: MediaInfo | undefined,
): { width: number; height: number } {
  const source =
    first?.width && first?.height ? { width: first.width, height: first.height } : FALLBACK;
  const aspect = source.width / source.height;
  const height = options.size === 'first' ? source.height : Number(options.size);
  return { width: even(height * aspect), height: even(height) };
}

export function slideFilter(
  options: ImagesVideoOptions,
  count: number,
  first: MediaInfo | undefined,
): string {
  const { width, height } = slideFrame(options, first);
  const chains: string[] = [];
  const pieces: string[] = [];
  for (let index = 0; index < count; index++) {
    chains.push(
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FRAME_RATE},format=yuv420p[v${index}]`,
    );
    pieces.push(`[v${index}]`);
  }
  chains.push(`${pieces.join('')}concat=n=${count}:v=1:a=0[v]`);
  return chains.join(';');
}

export function buildImagesVideoArgs(
  options: ImagesVideoOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  first: MediaInfo | undefined,
): string[] {
  const args: string[] = [];
  for (const path of paths.inputPaths) {
    // -loop and -t are input options: they turn one picture into a clip.
    args.push('-loop', '1', '-framerate', String(FRAME_RATE), '-t', String(options.seconds));
    args.push('-i', path);
  }
  args.push(
    '-filter_complex',
    slideFilter(options, paths.inputPaths.length, first),
    '-map',
    '[v]',
    ...h264OutputArgs({ quality: options.quality, audio: 'drop' }),
    paths.outputPath,
  );
  return args;
}

function slideSeconds(options: ImagesVideoOptions, context: OperationContext): number {
  return (context.inputs?.length ?? 1) * options.seconds;
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export const imagesVideo = defineOperation<ImagesVideoOptions>({
  id: 'images-video',
  route: 'slideshow',
  title: 'Pictures to video',
  verb: 'Make video',
  summary: 'Show each picture for a few seconds, one after another, as a video.',
  group: 'image',
  accepts: ['image'],
  inputs: { min: 1, max: 100 },
  defaults: DEFAULT_SLIDES,
  outputSuffix: 'slideshow',

  fields: [
    {
      kind: 'chips',
      key: 'seconds',
      label: 'Each picture for',
      choices: [
        { value: 1, label: '1 second' },
        { value: 2, label: '2 seconds' },
        { value: 3, label: '3 seconds' },
        { value: 5, label: '5 seconds' },
        { value: 10, label: '10 seconds' },
      ],
    },
    {
      kind: 'segmented',
      key: 'size',
      label: 'Frame size',
      hint: 'Pictures of a different shape get black bars rather than being stretched.',
      choices: [
        { value: 'first', label: 'Like the first picture' },
        { value: '1080', label: '1080p' },
        { value: '720', label: '720p' },
      ],
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      min: 0,
      max: 100,
      step: 1,
      endLabels: ['Smaller file', 'Better picture'],
      display: (options) => `${options.quality} · CRF ${qualityToCrf(options.quality, 'h264')}`,
    },
  ],

  preflight: (options, context) => {
    const frame = slideFrame(options, context.inputs?.[0]?.info);
    return frame.height > 2160
      ? [
          `The first picture is ${frame.width}×${frame.height}, which makes a very large video. 1080p is plenty for most screens.`,
        ]
      : [];
  },

  build: (options, paths, context) =>
    buildImagesVideoArgs(options, paths, context.inputs?.[0]?.info),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',
  outputDuration: (options, context) => slideSeconds(options, context),

  estimateBytes: (options, context) => {
    const estimate = estimateOutputBytes(
      { ...DEFAULT_COMPRESSION, quality: options.quality, audio: 'none' },
      {
        source: 'ffprobe',
        kind: 'video',
        durationSeconds: slideSeconds(options, context),
        ...slideFrame(options, context.inputs?.[0]?.info),
        frameRate: FRAME_RATE,
      },
    );
    return estimate === undefined ? undefined : Math.round(estimate * STILL_FACTOR);
  },
});
