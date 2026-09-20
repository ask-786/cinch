import { defineOperation } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Speed a video up or slow it down.
 *
 * Two filters have to agree: `setpts` restamps the frames, `atempo` stretches
 * the sound without dropping its pitch through the floor. `atempo` only
 * accepts a factor between 0.5 and 2, so anything beyond that is applied as a
 * chain of smaller steps.
 */

export type VideoSpeedOptions = {
  /** 2 plays twice as fast, 0.5 half as fast. */
  readonly factor: number | undefined;
  readonly keepAudio: boolean;
  readonly quality: number;
};

export const DEFAULT_SPEED: VideoSpeedOptions = {
  factor: 2,
  keepAudio: true,
  quality: 60,
};

const MIN_FACTOR = 0.1;
const MAX_FACTOR = 10;

export function clampFactor(factor: number | undefined): number {
  if (factor === undefined || Number.isNaN(factor) || factor <= 0) return 1;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
}

/**
 * `atempo` refuses anything outside 0.5–2, so a bigger change is applied in
 * steps that multiply out to the factor asked for: 4× becomes 2×2.
 */
export function atempoChain(factor: number): readonly number[] {
  const steps: number[] = [];
  let remaining = clampFactor(factor);

  while (remaining > 2) {
    steps.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push(0.5);
    remaining *= 2;
  }

  // A factor of exactly 1 after the steps would be a filter that does nothing.
  if (Math.abs(remaining - 1) > 0.0001 || steps.length === 0) steps.push(remaining);
  return steps;
}

/** Trailing zeroes read badly in a command the user can copy. */
function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function buildVideoSpeedArgs(
  options: VideoSpeedOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const factor = clampFactor(options.factor);
  const args = ['-i', paths.inputPath];

  args.push('-vf', `setpts=PTS/${trim(factor)}`);

  const keepsAudio = options.keepAudio;
  if (keepsAudio) {
    const chain = atempoChain(factor).map((step) => `atempo=${trim(step)}`);
    args.push('-af', chain.join(','));
  }

  args.push(
    ...h264OutputArgs({ quality: options.quality, audio: keepsAudio ? 'reencode' : 'drop' }),
    paths.outputPath,
  );
  return args;
}

export const videoSpeed = defineOperation<VideoSpeedOptions>({
  id: 'video-speed',
  route: 'speed',
  title: 'Change speed',
  verb: 'Change speed',
  summary: 'Play a video faster or slower, with the sound kept in step.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_SPEED,
  outputSuffix: 'speed',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to speed up.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'factor',
      label: 'Speed',
      choices: [
        { value: 0.25, label: '¼×', note: 'very slow' },
        { value: 0.5, label: '½×', note: 'slow motion' },
        { value: 1, label: '1×', note: 'unchanged' },
        { value: 1.5, label: '1½×' },
        { value: 2, label: '2×', note: 'double' },
        { value: 4, label: '4×' },
      ],
    },
    {
      kind: 'number',
      key: 'factor',
      label: 'Or type a number',
      suffix: '×',
      min: MIN_FACTOR,
      max: MAX_FACTOR,
      step: 0.1,
      placeholder: '2',
      hint: 'Above 1 is faster, below 1 is slower.',
    },
    {
      kind: 'toggle',
      key: 'keepAudio',
      label: 'Keep the sound',
      hint: 'The sound is stretched to match. Very large changes make it sound strange.',
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

  normalize: (options) => {
    // An empty box is a half-typed number, not a reason to rewrite the value.
    if (options.factor === undefined) return options;
    const clamped = clampFactor(options.factor);
    return clamped === options.factor ? options : { ...options, factor: clamped };
  },

  preflight: (options) => {
    const warnings: string[] = [];
    const factor = clampFactor(options.factor);

    if (factor === 1) {
      warnings.push('At 1× nothing changes, so this would re-encode the video for no reason.');
    }
    if (options.keepAudio && (factor > 4 || factor < 0.25)) {
      warnings.push(
        'A change this large leaves the sound sounding processed. Turning the sound off may be kinder than keeping it.',
      );
    }
    if (factor < 1) {
      warnings.push(
        'Slowing a video down repeats frames rather than inventing them, so it will look choppy unless the original was shot at a high frame rate.',
      );
    }
    return warnings;
  },

  build: (options, paths) => buildVideoSpeedArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  outputDuration: (options, context) => {
    const duration = context.info?.durationSeconds;
    if (duration === undefined) return undefined;
    return duration / clampFactor(options.factor);
  },

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    const bitrate = context.info?.bitrate;
    if (duration === undefined || bitrate === undefined) return undefined;
    // Same picture, fewer or more seconds of it.
    return Math.round((bitrate / 8) * (duration / clampFactor(options.factor)));
  },
});
