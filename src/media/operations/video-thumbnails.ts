import { defineOperation, type OperationContext } from './descriptor';

/**
 * One picture that shows a whole video at a glance: frames from evenly spaced
 * moments, laid out as a grid — a contact sheet.
 *
 * The spacing comes from the video's length, so the length has to be known
 * first. Frames are picked by timestamp for the same reason extract frames
 * does it: the core's `fps` filter drops the last pick.
 */

export type SheetGrid = '3' | '4' | '5';
export type SheetFormat = 'jpg' | 'png';

export type VideoThumbnailsOptions = {
  /** Columns and rows: 3 is a 3×3 sheet of nine. */
  readonly grid: SheetGrid;
  /** Width of each frame on the sheet. */
  readonly tileWidth: number;
  readonly format: SheetFormat;
};

export const DEFAULT_THUMBNAILS: VideoThumbnailsOptions = {
  grid: '4',
  tileWidth: 320,
  format: 'jpg',
};

/** When the length is unknown (the registry's smoke test): a frame every 10 s. */
const FALLBACK_INTERVAL = 10;

export function tileCount(options: VideoThumbnailsOptions): number {
  return Number(options.grid) ** 2;
}

/**
 * Seconds between frames. Dividing by the count, not count − 1, keeps the
 * last pick clear of the final frame, which is often black.
 */
export function sheetInterval(options: VideoThumbnailsOptions, durationSeconds: number): number {
  return Math.round((durationSeconds / tileCount(options)) * 1000) / 1000;
}

export function sheetFilter(options: VideoThumbnailsOptions, interval: number): string {
  const grid = `${options.grid}x${options.grid}`;
  return [
    `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${interval})'`,
    `scale=${options.tileWidth}:-2`,
    // A frame of padding between tiles, so they read as separate pictures.
    `tile=${grid}:padding=4:margin=4`,
  ].join(',');
}

export function buildVideoThumbnailsArgs(
  options: VideoThumbnailsOptions,
  paths: { inputPath: string; outputPath: string },
  durationSeconds: number | undefined,
): string[] {
  const interval =
    durationSeconds === undefined ? FALLBACK_INTERVAL : sheetInterval(options, durationSeconds);
  const args = [
    '-i',
    paths.inputPath,
    '-vf',
    sheetFilter(options, interval),
    '-fps_mode',
    'vfr',
    '-an',
    // One sheet. A short video that runs out of frames still flushes a partial one.
    '-frames:v',
    '1',
  ];
  if (options.format === 'jpg') args.push('-q:v', '2');
  args.push('-update', '1', paths.outputPath);
  return args;
}

function sheetSize(
  options: VideoThumbnailsOptions,
  context: OperationContext,
): { width: number; height: number } | undefined {
  const info = context.info;
  if (!info?.width || !info?.height) return undefined;
  const tileHeight = Math.round((options.tileWidth * info.height) / info.width);
  const count = Number(options.grid);
  return { width: count * (options.tileWidth + 4) + 4, height: count * (tileHeight + 4) + 4 };
}

export const videoThumbnails = defineOperation<VideoThumbnailsOptions>({
  id: 'video-thumbnails',
  route: 'thumbnails',
  title: 'Thumbnail sheet',
  verb: 'Make sheet',
  summary: 'One picture with frames from across the whole video, in a grid.',
  group: 'image',
  accepts: ['video'],
  defaults: DEFAULT_THUMBNAILS,
  outputSuffix: 'sheet',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to take frames from.' : undefined,

  fields: [
    {
      kind: 'segmented',
      key: 'grid',
      label: 'Frames',
      choices: [
        { value: '3', label: '3 × 3' },
        { value: '4', label: '4 × 4' },
        { value: '5', label: '5 × 5' },
      ],
    },
    {
      kind: 'chips',
      key: 'tileWidth',
      label: 'Each frame',
      choices: [
        { value: 240, label: '240 px' },
        { value: 320, label: '320 px' },
        { value: 480, label: '480 px' },
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
  ],

  preflight: (_options, context) =>
    context.info?.durationSeconds === undefined
      ? ['The length of this video is still being read, so the frames cannot be spaced yet.']
      : [],

  build: (options, paths, context) =>
    buildVideoThumbnailsArgs(options, paths, context.info?.durationSeconds),
  outputExtension: (options) => options.format,
  outputMime: (options) => (options.format === 'png' ? 'image/png' : 'image/jpeg'),

  estimateBytes: (options, context) => {
    const size = sheetSize(options, context);
    if (!size) return undefined;
    // The same rough bytes per pixel extract frames uses.
    return Math.round(size.width * size.height * (options.format === 'png' ? 1.5 : 0.2));
  },
});
