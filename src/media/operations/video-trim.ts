import { defineOperation, timestamp } from './descriptor';

/**
 * Cut a clip out of the middle. The one operation so far whose form a schema
 * cannot express — two handles that have to stay in order, against a preview
 * of the frame you are landing on — so it names a custom component (D23).
 */

export type VideoTrimOptions = {
  readonly startSeconds: number;
  readonly endSeconds: number;
  /**
   * Copying the streams is instant but can only cut on a keyframe, so the clip
   * may start a moment early. Re-encoding lands exactly where asked.
   */
  readonly exact: boolean;
};

export const DEFAULT_TRIM: VideoTrimOptions = {
  startSeconds: 0,
  endSeconds: 0,
  exact: false,
};

export function trimDuration(options: VideoTrimOptions): number {
  return Math.max(0, options.endSeconds - options.startSeconds);
}

export function buildVideoTrimArgs(
  options: VideoTrimOptions,
  paths: { inputPath: string; outputPath: string },
  extension: string,
): string[] {
  // -ss before -i is the fast seek: FFmpeg jumps in the file rather than
  // decoding up to the mark.
  const args = ['-ss', timestamp(options.startSeconds), '-i', paths.inputPath];

  const duration = trimDuration(options);
  if (duration > 0) args.push('-t', timestamp(duration));

  if (options.exact) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', '160k');
  } else {
    // Copying keeps the original timestamps, which can start negative after a
    // seek; zeroing them stops players from showing a frozen first second.
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  }

  if (extension === 'mp4' || extension === 'mov') args.push('-movflags', '+faststart');

  args.push(paths.outputPath);
  return args;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
};

/** Re-encoding always lands in MP4; copying keeps whatever the source was. */
function extensionFor(options: VideoTrimOptions, sourceExtension: string | undefined): string {
  if (options.exact) return 'mp4';
  return sourceExtension && MIME_BY_EXTENSION[sourceExtension] ? sourceExtension : 'mp4';
}

export const videoTrim = defineOperation<VideoTrimOptions>({
  id: 'video-trim',
  route: 'trim',
  title: 'Trim video',
  verb: 'Trim',
  summary: 'Keep the part you want and throw the rest away.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_TRIM,
  outputSuffix: 'clip',
  customForm: 'trim',

  // No generated fields: the custom form owns the whole thing.
  fields: [],

  normalize: (options, context) => {
    const duration = context.info?.durationSeconds;
    const end = options.endSeconds > 0 ? options.endSeconds : (duration ?? 0);
    const limit = duration ?? Math.max(end, options.startSeconds);
    const clampedEnd = Math.min(Math.max(end, 0), limit);
    const clampedStart = Math.min(Math.max(options.startSeconds, 0), Math.max(clampedEnd - 0.1, 0));
    return { ...options, startSeconds: clampedStart, endSeconds: clampedEnd };
  },

  preflight: (options, context) => {
    const warnings: string[] = [];
    if (trimDuration(options) <= 0) {
      warnings.push('The end of the clip is not after its start, so there is nothing to keep.');
    }
    if (!options.exact) {
      warnings.push(
        'Copying can only cut on a keyframe, so the clip may begin up to a couple of seconds early. Turn on "cut exactly" to land on the frame.',
      );
    }
    if (context.info?.durationSeconds === undefined) {
      warnings.push('The length of this file is still being read.');
    }
    return warnings;
  },

  build: (options, paths, context) =>
    buildVideoTrimArgs(options, paths, extensionFor(options, context.media?.extension)),

  outputExtension: (options, context) => extensionFor(options, context.media?.extension),
  outputMime: (options, context) =>
    MIME_BY_EXTENSION[extensionFor(options, context.media?.extension)] ?? 'video/mp4',

  outputDuration: (options) => trimDuration(options),

  estimateBytes: (options, context) => {
    const source = context.media?.size;
    const total = context.info?.durationSeconds;
    if (source === undefined || !total) return undefined;
    // A copy keeps the source's bitrate; an exact cut re-encodes at CRF 20,
    // which lands near enough for a line under a form.
    const share = Math.min(1, trimDuration(options) / total);
    return Math.round(source * share * (options.exact ? 0.85 : 1));
  },
});
