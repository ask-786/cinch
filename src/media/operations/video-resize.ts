import type { MediaInfo } from '../models/media-info';
import { defineOperation } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Change the picture's dimensions.
 *
 * Compression's `maxHeight` only ever shrinks to a standard height. This one
 * is the operation you reach for when the number matters — a 512 px square for
 * an avatar, an exact width a site demands — so both dimensions are typed in.
 *
 * The first descriptor to use typed-in numbers rather than a list of choices.
 */

export type ResizeMode = 'preset' | 'custom';

export type VideoResizeOptions = {
  readonly mode: ResizeMode;
  /** Target height for the preset mode, e.g. 1080. */
  readonly preset: number;
  /** Custom mode. Either may be left empty, and the other drives the aspect. */
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** Off means the typed width and height are used exactly, distortion and all. */
  readonly keepAspect: boolean;
  readonly quality: number;
};

export const DEFAULT_RESIZE: VideoResizeOptions = {
  mode: 'preset',
  preset: 1080,
  width: undefined,
  height: undefined,
  keepAspect: true,
  quality: 60,
};

/** Codecs need even dimensions; an odd number typed in is rounded down. */
function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * The scale filter for these options, or undefined when there is nothing to do.
 *
 * `-2` tells FFmpeg to work the dimension out from the aspect ratio and land
 * on an even number, which is why a half-filled custom form still works.
 */
export function resizeFilter(options: VideoResizeOptions): string | undefined {
  if (options.mode === 'preset') {
    return `scale=-2:${even(options.preset)}`;
  }

  const width = options.width === undefined ? undefined : even(options.width);
  const height = options.height === undefined ? undefined : even(options.height);

  if (width === undefined && height === undefined) return undefined;
  if (width === undefined) return `scale=-2:${height}`;
  if (height === undefined) return `scale=${width}:-2`;

  // Both given: either letterbox-free exact numbers, or fit inside the box.
  if (!options.keepAspect) return `scale=${width}:${height}`;
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
}

/** What the output will actually measure, for the line under the form. */
export function resizedDimensions(
  options: VideoResizeOptions,
  info?: MediaInfo,
): { width: number; height: number } | undefined {
  const sourceWidth = info?.width;
  const sourceHeight = info?.height;
  if (!sourceWidth || !sourceHeight) return undefined;

  const ratio = sourceWidth / sourceHeight;

  if (options.mode === 'preset') {
    const height = even(options.preset);
    return { width: even(height * ratio), height };
  }

  const width = options.width === undefined ? undefined : even(options.width);
  const height = options.height === undefined ? undefined : even(options.height);

  if (width === undefined && height === undefined) {
    return { width: sourceWidth, height: sourceHeight };
  }
  if (width === undefined) return { width: even(height! * ratio), height: height! };
  if (height === undefined) return { width, height: even(width / ratio) };
  if (!options.keepAspect) return { width, height };

  // Fitted inside the box, so whichever side binds first decides.
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return { width: even(sourceWidth * scale), height: even(sourceHeight * scale) };
}

export function buildVideoResizeArgs(
  options: VideoResizeOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath];

  const filter = resizeFilter(options);
  if (filter) args.push('-vf', filter);

  // Resizing does not touch the sound, so it is copied rather than re-encoded.
  args.push(...h264OutputArgs({ quality: options.quality, audio: 'copy' }), paths.outputPath);
  return args;
}

export const videoResize = defineOperation<VideoResizeOptions>({
  id: 'video-resize',
  route: 'resize',
  title: 'Resize video',
  verb: 'Resize',
  summary: 'Change the width and height, by a standard size or your own numbers.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_RESIZE,
  outputSuffix: 'resized',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to resize.' : undefined,

  fields: [
    {
      kind: 'segmented',
      key: 'mode',
      label: 'Size',
      choices: [
        { value: 'preset', label: 'A standard size' },
        { value: 'custom', label: 'My own numbers' },
      ],
    },
    {
      kind: 'select',
      key: 'preset',
      label: 'Height',
      visibleWhen: (options) => options.mode === 'preset',
      choices: (_options, context) => {
        const source = context.info?.height;
        return [2160, 1440, 1080, 720, 480, 360].map((height) => ({
          value: height,
          label: `${height}p`,
          note:
            source !== undefined && height > source
              ? 'larger than the original'
              : LABELS[height as keyof typeof LABELS],
        }));
      },
    },
    {
      kind: 'number',
      key: 'width',
      label: 'Width',
      suffix: 'px',
      min: 2,
      max: 7680,
      step: 2,
      placeholder: 'auto',
      visibleWhen: (options) => options.mode === 'custom',
      hint: 'Leave one side empty and it follows the other.',
    },
    {
      kind: 'number',
      key: 'height',
      label: 'Height',
      suffix: 'px',
      min: 2,
      max: 4320,
      step: 2,
      placeholder: 'auto',
      visibleWhen: (options) => options.mode === 'custom',
    },
    {
      kind: 'toggle',
      key: 'keepAspect',
      label: 'Keep the shape of the picture',
      visibleWhen: (options) =>
        options.mode === 'custom' && options.width !== undefined && options.height !== undefined,
      hint: 'On, the picture fits inside your numbers. Off, it is stretched to them exactly.',
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
    const warnings: string[] = [];
    const target = resizedDimensions(options, context.info);
    const source = context.info;

    if (target && source?.width && source.height && target.width > source.width) {
      warnings.push(
        'This is bigger than the original. Enlarging cannot add detail that was never there, and the file will grow.',
      );
    }
    if (options.mode === 'custom' && options.width === undefined && options.height === undefined) {
      warnings.push('Fill in a width or a height, or the video comes out the size it went in.');
    }
    return warnings;
  },

  build: (options, paths) => buildVideoResizeArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    const target = resizedDimensions(options, context.info);
    if (duration === undefined || !target) return undefined;

    // Bits per pixel per frame at CRF 23, fitted against the compress numbers.
    const crf = qualityToCrf(options.quality, 'h264');
    const bitsPerPixel = 0.09 * Math.pow(2, (23 - crf) / 6);
    const frameRate = context.info?.frameRate ?? 30;
    const videoBps = target.width * target.height * frameRate * bitsPerPixel;

    return Math.round(((videoBps + 128_000) / 8) * duration);
  },
});

const LABELS = {
  2160: '4K',
  1440: '2K',
  1080: 'Full HD',
  720: 'HD',
  480: 'small',
  360: 'smallest',
} as const;
