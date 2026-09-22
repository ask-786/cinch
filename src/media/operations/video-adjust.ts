import { defineOperation } from './descriptor';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Brighten, add contrast or colour, sharpen or soften a video.
 *
 * Every slider runs from -100 to 100 with 0 meaning "leave it", so the form
 * reads the same way for all four. The ranges behind them are narrower than
 * FFmpeg's own: `eq` accepts a brightness of ±1, which turns the picture white
 * or black, and nobody wants that from a slider's far end.
 *
 * Sharpness is one slider for two filters: below zero is `gblur`, a soft
 * blur; above zero is `unsharp`, which sharpens edges.
 */

export type VideoAdjustOptions = {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly sharpness: number;
  readonly quality: number;
};

export const DEFAULT_ADJUST: VideoAdjustOptions = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
  quality: 60,
};

/** Trailing zeroes read badly in a command the user can copy. */
function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function eqFilter(options: VideoAdjustOptions): string | undefined {
  const parts: string[] = [];
  if (options.brightness !== 0) parts.push(`brightness=${trim((options.brightness / 100) * 0.25)}`);
  if (options.contrast !== 0) parts.push(`contrast=${trim(1 + (options.contrast / 100) * 0.5)}`);
  if (options.saturation !== 0) parts.push(`saturation=${trim(1 + options.saturation / 100)}`);
  return parts.length ? `eq=${parts.join(':')}` : undefined;
}

export function sharpnessFilter(sharpness: number): string | undefined {
  if (sharpness < 0) return `gblur=sigma=${trim(-sharpness / 10)}`;
  // A 5×5 matrix on the brightness only: sharpening colour just adds fringes.
  if (sharpness > 0) return `unsharp=5:5:${trim((sharpness / 100) * 1.5)}`;
  return undefined;
}

export function adjustFilter(options: VideoAdjustOptions): string | undefined {
  const steps = [eqFilter(options), sharpnessFilter(options.sharpness)].filter(
    (step): step is string => step !== undefined,
  );
  return steps.length ? steps.join(',') : undefined;
}

export function buildVideoAdjustArgs(
  options: VideoAdjustOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath];
  const filter = adjustFilter(options);
  if (filter) args.push('-vf', filter);
  args.push(...h264OutputArgs({ quality: options.quality, audio: 'copy' }), paths.outputPath);
  return args;
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export const videoAdjust = defineOperation<VideoAdjustOptions>({
  id: 'video-adjust',
  route: 'adjust',
  title: 'Colour and sharpness',
  verb: 'Adjust',
  summary: 'Brighten, add contrast or colour, sharpen or soften a video.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_ADJUST,
  outputSuffix: 'adjusted',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to adjust.' : undefined,

  fields: [
    {
      kind: 'slider',
      key: 'brightness',
      label: 'Brightness',
      min: -100,
      max: 100,
      step: 1,
      endLabels: ['Darker', 'Brighter'],
      display: (options) => signed(options.brightness),
    },
    {
      kind: 'slider',
      key: 'contrast',
      label: 'Contrast',
      min: -100,
      max: 100,
      step: 1,
      endLabels: ['Flatter', 'Punchier'],
      display: (options) => signed(options.contrast),
    },
    {
      kind: 'slider',
      key: 'saturation',
      label: 'Colour',
      min: -100,
      max: 100,
      step: 1,
      endLabels: ['Black and white', 'Vivid'],
      display: (options) => signed(options.saturation),
    },
    {
      kind: 'slider',
      key: 'sharpness',
      label: 'Sharpness',
      min: -100,
      max: 100,
      step: 1,
      endLabels: ['Blur', 'Sharpen'],
      display: (options) => signed(options.sharpness),
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

  preflight: (options) =>
    adjustFilter(options) === undefined
      ? ['Every slider is at 0, so this would re-encode the video for no reason.']
      : [],

  build: (options, paths) => buildVideoAdjustArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  // Same frame, same length. Blur makes it smaller and sharpening bigger, but
  // not by enough to beat the guess's own error.
  estimateBytes: (_options, context) => sameSizeEstimate(context.info),
});
