import { defineOperation } from './descriptor';
import { cappedBitrateArgs } from './video-compress';

/**
 * Re-encode a video at a bitrate the user names.
 *
 * Compress already covers "smaller" and "this many megabytes". This is for
 * when the number itself is the requirement — a streaming platform's ceiling,
 * a broadcast spec — so the box takes kilobits per second, and the sound is
 * copied across untouched so the number means the picture alone.
 */

export type VideoBitrateOptions = {
  readonly kbps: number | undefined;
};

export const DEFAULT_BITRATE: VideoBitrateOptions = {
  kbps: 2500,
};

const MIN_KBPS = 100;
const MAX_KBPS = 50_000;

/** When the sound's own bitrate is not known: what most files carry. */
const ASSUMED_AUDIO_KBPS = 128;

export function clampKbps(kbps: number | undefined): number {
  if (kbps === undefined || Number.isNaN(kbps)) return DEFAULT_BITRATE.kbps ?? 2500;
  return Math.round(Math.min(MAX_KBPS, Math.max(MIN_KBPS, kbps)));
}

export function buildVideoBitrateArgs(
  options: VideoBitrateOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    ...cappedBitrateArgs(clampKbps(options.kbps)),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    paths.outputPath,
  ];
}

export const videoBitrate = defineOperation<VideoBitrateOptions>({
  id: 'video-bitrate',
  route: 'bitrate',
  title: 'Change bitrate',
  verb: 'Re-encode',
  summary: 'Re-encode a video at an exact bitrate, for a platform or spec that asks for one.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_BITRATE,
  outputSuffix: 'bitrate',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to re-encode.' : undefined,

  fields: [
    {
      kind: 'number',
      key: 'kbps',
      label: 'Video bitrate',
      suffix: 'kbps',
      min: MIN_KBPS,
      max: MAX_KBPS,
      step: 100,
      placeholder: '2500',
      hint: 'For the picture only; the sound is kept as it is. 1000 kbps is 7.5 MB a minute.',
    },
  ],

  normalize: (options) => {
    // An empty box is a half-typed number, not a reason to rewrite the value.
    if (options.kbps === undefined) return options;
    const clamped = clampKbps(options.kbps);
    return clamped === options.kbps ? options : { ...options, kbps: clamped };
  },

  preflight: (options, context) => {
    const source = context.info?.bitrate;
    if (source === undefined) return [];
    const sourceKbps = Math.round(source / 1000);
    return clampKbps(options.kbps) >= sourceKbps
      ? [
          `The original is about ${sourceKbps} kbps in all. A higher bitrate makes a bigger file, not a better picture.`,
        ]
      : [];
  },

  build: (options, paths) => buildVideoBitrateArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    if (duration === undefined) return undefined;
    const audio = context.info?.hasAudio === false ? 0 : ASSUMED_AUDIO_KBPS;
    return Math.round(((clampKbps(options.kbps) + audio) * 1000 * duration) / 8);
  },
});
