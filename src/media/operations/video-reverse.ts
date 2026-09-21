import type { MediaInfo } from '../models/media-info';
import { defineOperation, type Choice } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Play a video backwards.
 *
 * `reverse` and `areverse` cannot write a frame until they have read the last
 * one, so the whole clip sits in memory as raw pictures first. That is the
 * whole cost of this operation: a minute of 1080p is several gigabytes, and the
 * fast core has a fixed 1 GB. So the frame can be shrunk *before* it is
 * buffered, sizes that would not fit are ruled out, and a clip that fits at
 * no size is turned away with a pointer to trim.
 */

export type VideoReverseOptions = {
  /** Target height, or 0 to keep the original. */
  readonly height: number;
  readonly keepAudio: boolean;
  readonly quality: number;
};

export const DEFAULT_REVERSE: VideoReverseOptions = {
  height: 0,
  keepAudio: true,
  quality: 60,
};

/** Past this the job is refused: the buffer plus the encoder no longer fit the fast core. */
export const REVERSE_LIMIT_BYTES = 500_000_000;
/** Past this it still runs, but a trim first would be kinder. */
export const REVERSE_WARN_BYTES = 250_000_000;

const HEIGHTS = [720, 480, 360] as const;

/** When the frame rate has not been read yet: most footage is 30 or less. */
const FALLBACK_FPS = 30;

/**
 * Raw frames are YUV 4:2:0, so 1.5 bytes a pixel. The sound is buffered as
 * 32-bit float samples, which is small beside the picture but not nothing.
 */
export function reverseBufferBytes(
  info: MediaInfo | undefined,
  height: number,
): number | undefined {
  if (
    info?.width === undefined ||
    info.height === undefined ||
    info.durationSeconds === undefined
  ) {
    return undefined;
  }
  const scale = height > 0 && height < info.height ? height / info.height : 1;
  const width = info.width * scale;
  const tall = info.height * scale;
  const fps = info.frameRate ?? FALLBACK_FPS;
  const picture = width * tall * 1.5 * fps * info.durationSeconds;
  const sound = info.hasAudio === false ? 0 : 48_000 * 2 * 4 * info.durationSeconds;
  return Math.round(picture + sound);
}

/** Whether a size would fit; unknown counts as fitting until we know better. */
function fits(info: MediaInfo | undefined, height: number): boolean {
  const bytes = reverseBufferBytes(info, height);
  return bytes === undefined || bytes <= REVERSE_LIMIT_BYTES;
}

export function reverseSizeChoices(info: MediaInfo | undefined): readonly Choice[] {
  const source = info?.height;
  const choices: Choice[] = [{ value: 0, label: 'Original', disabled: !fits(info, 0) }];
  for (const height of HEIGHTS) {
    // A size at or above the source's own would not shrink anything.
    if (source !== undefined && height >= source) continue;
    choices.push({ value: height, label: `${height}p`, disabled: !fits(info, height) });
  }
  return choices;
}

export function buildVideoReverseArgs(
  options: VideoReverseOptions,
  paths: { inputPath: string; outputPath: string },
  info?: MediaInfo,
): string[] {
  const args = ['-i', paths.inputPath];

  // Scaling first means the smaller frames are what gets buffered.
  const shrinks =
    options.height > 0 && (info?.height === undefined || options.height < info.height);
  args.push('-vf', shrinks ? `scale=-2:${options.height},reverse` : 'reverse');

  const keepsAudio = options.keepAudio && info?.hasAudio !== false;
  if (keepsAudio) args.push('-af', 'areverse');

  args.push(
    ...h264OutputArgs({ quality: options.quality, audio: keepsAudio ? 'reencode' : 'drop' }),
    paths.outputPath,
  );
  return args;
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export const videoReverse = defineOperation<VideoReverseOptions>({
  id: 'video-reverse',
  route: 'reverse',
  title: 'Reverse',
  verb: 'Reverse',
  summary: 'Play a video backwards, sound and all.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_REVERSE,
  outputSuffix: 'reversed',

  rejects: (context) => {
    if (context.info?.hasVideo === false) return 'This file has no picture to reverse.';
    const smallest = reverseBufferBytes(context.info, HEIGHTS.at(-1) ?? 0);
    return smallest !== undefined && smallest > REVERSE_LIMIT_BYTES
      ? 'This video is too long to reverse in the browser: the whole clip has to be held in memory at once. Trim it into shorter pieces first.'
      : undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'height',
      label: 'Size',
      hint: 'The whole clip is held in memory while it is reversed. A smaller size lets a longer clip fit.',
      choices: (_options, context) => reverseSizeChoices(context.info),
    },
    {
      kind: 'toggle',
      key: 'keepAudio',
      label: 'Reverse the sound too',
      hint: 'Off leaves the video silent.',
      visibleWhen: (_options, context) => context.info?.hasAudio !== false,
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

  normalize: (options, context) => {
    // A size that no longer fits (or no longer exists) gives way to the
    // largest one that does.
    const choices = reverseSizeChoices(context.info);
    const current = choices.find((choice) => choice.value === options.height);
    if (current && !current.disabled) return options;
    const largest = choices.find((choice) => !choice.disabled);
    const height = typeof largest?.value === 'number' ? largest.value : options.height;
    return height === options.height ? options : { ...options, height };
  },

  preflight: (options, context) => {
    const bytes = reverseBufferBytes(context.info, options.height);
    if (bytes === undefined) {
      return [
        'The video’s size and length are still being read, so its memory needs are not known yet.',
      ];
    }
    if (bytes > REVERSE_WARN_BYTES) {
      return [
        `This holds about ${mb(bytes)} in memory while it works, which may be too much for some devices. A smaller size or a shorter trim is safer.`,
      ];
    }
    return [];
  },

  build: (options, paths, context) => buildVideoReverseArgs(options, paths, context.info),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const info = context.info;
    if (info?.durationSeconds === undefined || info.bitrate === undefined) return undefined;
    // A smaller frame costs roughly its share of the pixels.
    const scale =
      options.height > 0 && info.height !== undefined && options.height < info.height
        ? (options.height / info.height) ** 2
        : 1;
    return Math.round((info.bitrate / 8) * info.durationSeconds * scale);
  },
});
