import type { MediaInfo } from '../models/media-info';
import { defineOperation } from './descriptor';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Fit a video into a different shape by adding bars, not by cutting anything
 * off: a landscape clip made square for a feed, a portrait one made 16:9.
 *
 * The frame only ever grows. Scaling down to fit would soften the picture for
 * no reason, and the player scales it anyway. The bars can be black, white, or
 * a blurred, enlarged copy of the video itself — the look phones use when a
 * portrait clip is shown in a landscape frame.
 */

export type PadRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
export type PadBackground = 'black' | 'white' | 'blur';

export type VideoPadOptions = {
  readonly ratio: PadRatio;
  readonly background: PadBackground;
  readonly quality: number;
};

export const DEFAULT_PAD: VideoPadOptions = {
  ratio: '1:1',
  background: 'blur',
  quality: 60,
};

function ratioParts(ratio: PadRatio): [number, number] {
  const [w, h] = ratio.split(':').map(Number);
  return [w, h];
}

function evenUp(value: number): number {
  return Math.ceil(value / 2) * 2;
}

/**
 * The padded frame: whichever side is short for the ratio grows, the other
 * stays. Both end up even, which H.264 needs.
 */
export function paddedSize(
  width: number,
  height: number,
  ratio: PadRatio,
): { width: number; height: number } {
  const [rw, rh] = ratioParts(ratio);
  const target = rw / rh;
  if (width / height < target) {
    return { width: Math.max(evenUp(width), evenUp(height * target)), height: evenUp(height) };
  }
  return { width: evenUp(width), height: Math.max(evenUp(height), evenUp(width / target)) };
}

/** Whether the video is already the shape asked for, give or take rounding. */
export function alreadyFits(info: MediaInfo | undefined, ratio: PadRatio): boolean {
  if (info?.width === undefined || info.height === undefined) return false;
  const size = paddedSize(info.width, info.height, ratio);
  return size.width - info.width <= 2 && size.height - info.height <= 2;
}

export function padFilter(options: VideoPadOptions, info: MediaInfo | undefined): string {
  const center = 'x=(ow-iw)/2:y=(oh-ih)/2';

  if (info?.width === undefined || info.height === undefined) {
    // No size yet: let FFmpeg work the frame out from the input's own. The
    // blurred copy needs real numbers, so it falls back to plain bars.
    const [rw, rh] = ratioParts(options.ratio);
    const color = options.background === 'white' ? 'white' : 'black';
    return (
      `pad=w='max(iw,ceil(ih*${rw}/${rh}/2)*2)':h='max(ih,ceil(iw*${rh}/${rw}/2)*2)':` +
      `${center}:color=${color}`
    );
  }

  const { width, height } = paddedSize(info.width, info.height, options.ratio);

  if (options.background !== 'blur') {
    return `pad=${width}:${height}:${center}:color=${options.background}`;
  }

  // One copy is enlarged to cover the new frame, cropped to it and blurred;
  // the untouched copy sits on top in the middle. The blur runs at a quarter
  // of the size and is scaled back up: nobody can tell on a blurred picture,
  // and it is 3–4× faster (measured). boxblur's radius has to stay under a
  // quarter of the smaller side, for the half-size colour planes.
  const smallWidth = evenUp(width / 4);
  const smallHeight = evenUp(height / 4);
  const radius = Math.max(2, Math.round(Math.min(smallWidth, smallHeight) / 20));
  return (
    `split[bg][fg];` +
    `[bg]scale=${smallWidth}:${smallHeight}:force_original_aspect_ratio=increase,` +
    `crop=${smallWidth}:${smallHeight},boxblur=${radius}:2,scale=${width}:${height}[blurred];` +
    `[blurred][fg]overlay=(W-w)/2:(H-h)/2`
  );
}

export function buildVideoPadArgs(
  options: VideoPadOptions,
  paths: { inputPath: string; outputPath: string },
  info?: MediaInfo,
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-vf',
    padFilter(options, info),
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  ];
}

export const videoPad = defineOperation<VideoPadOptions>({
  id: 'video-pad',
  route: 'pad',
  title: 'Fit to a shape',
  verb: 'Fit',
  summary: 'Add bars to fit a video into square, portrait or widescreen without cropping it.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_PAD,
  outputSuffix: 'fitted',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to fit.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'ratio',
      label: 'Shape',
      choices: [
        { value: '16:9', label: '16:9', note: 'widescreen' },
        { value: '9:16', label: '9:16', note: 'stories, reels' },
        { value: '1:1', label: '1:1', note: 'square' },
        { value: '4:5', label: '4:5', note: 'portrait post' },
        { value: '4:3', label: '4:3', note: 'classic TV' },
      ],
    },
    {
      kind: 'segmented',
      key: 'background',
      label: 'Bars',
      choices: [
        { value: 'blur', label: 'Blurred video' },
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
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
    const info = context.info;
    if (info?.width === undefined || info.height === undefined) {
      return options.background === 'blur'
        ? ['The size of the video is still being read. Until it is, the bars will be black.']
        : ['The size of the video is still being read.'];
    }
    if (alreadyFits(info, options.ratio)) {
      return [`The video is already ${options.ratio}, so this would re-encode it for no reason.`];
    }
    return [];
  },

  build: (options, paths, context) => buildVideoPadArgs(options, paths, context.info),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const same = sameSizeEstimate(context.info);
    if (same === undefined || options.background !== 'blur') return same;
    // Flat bars cost next to nothing; a blurred picture in them costs something.
    const info = context.info;
    if (info?.width === undefined || info.height === undefined) return same;
    const size = paddedSize(info.width, info.height, options.ratio);
    const grown = (size.width * size.height) / (info.width * info.height);
    return Math.round(same * (1 + (grown - 1) * 0.3));
  },
});
