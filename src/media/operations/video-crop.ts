import { displaySize } from '../models/media-info';
import { defineOperation } from './descriptor';
import { h264Estimate, h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Cut the edges off the picture: a square for a profile, a vertical slice of a
 * wide shot, a stray thumb at the side.
 *
 * The box is measured on the picture the way it plays. FFmpeg turns a phone
 * video upright before `crop` sees it, so a box drawn over the preview lands
 * where it was drawn. The form is custom (D23) for the box you drag over the
 * frame; every number it sets is also an ordinary field underneath.
 */

export type CropAspect = 'free' | 'original' | '1:1' | '16:9' | '9:16' | '4:5' | '4:3';

export type VideoCropOptions = {
  readonly aspect: CropAspect;
  /** The box, in pixels of the upright picture. Unset means "fit it for me". */
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly quality: number;
  /**
   * The shape and picture size the box was last fitted to, as `1:1 1920x1080`.
   * When it no longer matches, the user has picked a new shape or a different
   * file, and the box is refitted from scratch rather than squeezed out of
   * whatever it was before.
   */
  readonly fittedTo: string | undefined;
};

export const DEFAULT_CROP: VideoCropOptions = {
  aspect: 'free',
  width: undefined,
  height: undefined,
  x: undefined,
  y: undefined,
  quality: 60,
  fittedTo: undefined,
};

/** Width over height, as the two whole numbers FFmpeg's expressions take. */
const RATIOS: Readonly<
  Record<Exclude<CropAspect, 'free' | 'original'>, readonly [number, number]>
> = {
  '1:1': [1, 1],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:5': [4, 5],
  '4:3': [4, 3],
};

type Frame = { readonly width: number; readonly height: number };

function ratioOf(aspect: CropAspect, frame: Frame): number | undefined {
  if (aspect === 'free') return undefined;
  if (aspect === 'original') return frame.width / frame.height;
  const [w, h] = RATIOS[aspect];
  return w / h;
}

/** H.264 in 4:2:0 wants even sizes; the core rounds odd ones down anyway. */
function even(value: number): number {
  return Math.max(2, evenDown(value));
}

function evenDown(value: number): number {
  return Math.floor(value / 2) * 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Puts the box in order against the picture: a fresh fit when the shape
 * changed, the height following the width while a shape is held, everything
 * inside the frame and on even numbers.
 */
export function fitCrop(options: VideoCropOptions, frame: Frame): VideoCropOptions {
  const fit = `${options.aspect} ${frame.width}x${frame.height}`;
  const refit = fit !== options.fittedTo;
  const ratio = ratioOf(options.aspect, frame);
  const wanted = refit ? undefined : options.width;

  let width: number;
  let height: number;
  if (ratio === undefined) {
    width = clamp(wanted ?? frame.width, 2, frame.width);
    height = clamp((refit ? undefined : options.height) ?? frame.height, 2, frame.height);
  } else {
    // The biggest box of this shape, unless the user asked for a narrower one.
    width = even(Math.min(wanted ?? frame.width, frame.width, frame.height * ratio));
    // From the even width, so a second pass lands on the same height.
    height = Math.min(Math.max(2, Math.round(width / ratio / 2) * 2), evenDown(frame.height));
  }
  width = even(width);
  height = even(height);

  const x = refit ? undefined : options.x;
  const y = refit ? undefined : options.y;
  return {
    ...options,
    width,
    height,
    // Centred until the user moves it. Even too, so the colour planes line up.
    x: evenDown(clamp(x ?? (frame.width - width) / 2, 0, frame.width - width)),
    y: evenDown(clamp(y ?? (frame.height - height) / 2, 0, frame.height - height)),
    fittedTo: fit,
  };
}

/**
 * The crop filter. Any part of the box not worked out yet — the picture's size
 * was still unknown — is left to FFmpeg's own expressions, so the command
 * does the same thing either way.
 */
export function cropFilter(options: VideoCropOptions): string {
  let width = options.width === undefined ? 'iw' : String(options.width);
  let height = options.height === undefined ? 'ih' : String(options.height);

  if (options.width === undefined && options.aspect !== 'free' && options.aspect !== 'original') {
    const [w, h] = RATIOS[options.aspect];
    // Commas separate filters, so the ones inside `min` are escaped.
    width = `min(iw\\,ih*${w}/${h})`;
    height = `min(ih\\,iw*${h}/${w})`;
  }

  const x = options.x === undefined ? '(iw-ow)/2' : String(options.x);
  const y = options.y === undefined ? '(ih-oh)/2' : String(options.y);
  return `crop=${width}:${height}:${x}:${y}`;
}

export function buildVideoCropArgs(
  options: VideoCropOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-vf',
    cropFilter(options),
    // Cropping does not touch the sound, so it is copied rather than re-encoded.
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  ];
}

export const videoCrop = defineOperation<VideoCropOptions>({
  id: 'video-crop',
  route: 'crop',
  title: 'Crop video',
  verb: 'Crop',
  summary: 'Cut away the edges of the picture, to a shape you pick or a box you draw.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_CROP,
  outputSuffix: 'cropped',
  customForm: 'crop',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to crop.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'aspect',
      label: 'Shape',
      choices: [
        { value: 'free', label: 'Any' },
        { value: 'original', label: 'As the original' },
        { value: '1:1', label: 'Square' },
        { value: '16:9', label: '16:9', note: 'wide' },
        { value: '9:16', label: '9:16', note: 'vertical' },
        { value: '4:5', label: '4:5', note: 'portrait' },
        { value: '4:3', label: '4:3' },
      ],
    },
    { kind: 'number', key: 'width', label: 'Width', suffix: 'px', min: 2, step: 2 },
    {
      kind: 'number',
      key: 'height',
      label: 'Height',
      suffix: 'px',
      min: 2,
      step: 2,
      // With a shape picked, the height follows the width.
      visibleWhen: (options) => options.aspect === 'free',
    },
    { kind: 'number', key: 'x', label: 'From the left', suffix: 'px', min: 0, step: 2 },
    { kind: 'number', key: 'y', label: 'From the top', suffix: 'px', min: 0, step: 2 },
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

  // The page can open before the file is measured; the box waits for it.
  normalize: (options, context) => {
    const frame = displaySize(context.info);
    // Nothing smaller than one even-sized box can be cut from.
    return frame && frame.width >= 2 && frame.height >= 2 ? fitCrop(options, frame) : options;
  },

  // The page opens on the whole picture, which is a starting point rather than
  // a mistake, so it holds the run back quietly instead of warning.
  incomplete: (options, context) => {
    const frame = displaySize(context.info);
    return frame && options.width === frame.width && options.height === frame.height
      ? 'Pick a shape or drag the corners of the box to choose what to keep.'
      : undefined;
  },

  preflight: (_options, context) =>
    context.media && !displaySize(context.info)
      ? ['The size of the picture is still being read.']
      : [],

  build: (options, paths) => buildVideoCropArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const frame = displaySize(context.info);
    const box =
      options.width !== undefined && options.height !== undefined
        ? { width: options.width, height: options.height }
        : frame;
    if (!box) return undefined;

    const fresh = h264Estimate(box, options.quality, context.info);
    // Cutting away part of the picture rarely costs more than the source spent
    // on it, which keeps a lean source from being estimated at many times its size.
    const source = sameSizeEstimate(context.info);
    const kept = frame ? (box.width * box.height) / (frame.width * frame.height) : 1;
    if (fresh === undefined || source === undefined) return fresh;
    return Math.min(fresh, Math.round(source * kept));
  },
});
