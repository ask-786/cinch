import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';
import { defineOperation, type OperationContext, type OperationInput } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Put a logo in the corner of a video.
 *
 * Two files go in, a video and a picture, in either order. The logo is sized
 * against the video's width rather than kept at its own pixels, so the same
 * PNG looks the same on a phone clip and on 4K footage. It is one still frame;
 * `overlay` holds it for the whole video and stops when the video does.
 */

export type WatermarkPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export type VideoWatermarkOptions = {
  readonly position: WatermarkPosition;
  /** The logo's width as a share of the video's, in percent. */
  readonly size: number;
  /** 0–100. */
  readonly opacity: number;
  readonly quality: number;
};

export const DEFAULT_WATERMARK: VideoWatermarkOptions = {
  position: 'bottom-right',
  size: 15,
  opacity: 80,
  quality: 60,
};

/** When the video's width is still being read. */
const FALLBACK_WIDTH = 1280;

/** Which input is the video and which the logo. */
export function watermarkRoles(kinds: readonly (MediaKind | undefined)[]): {
  video: number;
  logo: number;
} {
  return kinds[0] === 'image' ? { video: 1, logo: 0 } : { video: 0, logo: 1 };
}

/** `overlay` places the logo's top-left corner; W and w are the video's and logo's widths. */
export function watermarkPlacement(
  position: WatermarkPosition,
  margin: number,
): { x: string; y: string } {
  if (position === 'center') return { x: '(W-w)/2', y: '(H-h)/2' };
  const [vertical, horizontal] = position.split('-');
  return {
    x: horizontal === 'left' ? String(margin) : `W-w-${margin}`,
    y: vertical === 'top' ? String(margin) : `H-h-${margin}`,
  };
}

export function watermarkFilter(
  options: VideoWatermarkOptions,
  roles: { video: number; logo: number },
  video: MediaInfo | undefined,
): string {
  const width = video?.width ?? FALLBACK_WIDTH;
  const logoWidth = Math.max(2, Math.round((width * options.size) / 100));
  // A small gap from the edge, in proportion, so the logo never touches it.
  const margin = Math.round(width * 0.03);
  const { x, y } = watermarkPlacement(options.position, margin);
  const alpha = (options.opacity / 100).toFixed(2);

  return (
    `[${roles.logo}:v:0]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${alpha}[logo];` +
    `[${roles.video}:v:0][logo]overlay=${x}:${y},format=yuv420p[v]`
  );
}

export function buildVideoWatermarkArgs(
  options: VideoWatermarkOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  inputs: readonly (OperationInput | undefined)[],
): string[] {
  const roles = watermarkRoles(inputs.map((input) => input?.media.kind));
  const video = inputs[roles.video]?.info;
  const args: string[] = [];
  for (const path of paths.inputPaths) args.push('-i', path);
  args.push('-filter_complex', watermarkFilter(options, roles, video), '-map', '[v]');
  // `?`: a silent video simply has no sound to carry across.
  args.push('-map', `${roles.video}:a:0?`);
  args.push(...h264OutputArgs({ quality: options.quality, audio: 'copy' }), paths.outputPath);
  return args;
}

function videoInput(context: OperationContext): OperationInput | undefined {
  const inputs = context.inputs ?? [];
  return inputs[watermarkRoles(inputs.map((input) => input.media.kind)).video];
}

export const videoWatermark = defineOperation<VideoWatermarkOptions>({
  id: 'video-watermark',
  route: 'watermark',
  title: 'Add a logo',
  verb: 'Add logo',
  summary: 'Put a picture in the corner of a video, see-through if you like.',
  group: 'video',
  accepts: ['video', 'image'],
  inputs: { min: 2, max: 2 },
  requires: ['video', 'image'],
  defaults: DEFAULT_WATERMARK,
  outputSuffix: 'logo',

  rejects: (context) => {
    const kinds = context.inputs?.map((input) => input.media.kind) ?? [];
    if (kinds.length === 2 && !(kinds.includes('video') && kinds.includes('image'))) {
      return 'This takes one video and one picture to put on it.';
    }
    return videoInput(context)?.info?.hasVideo === false
      ? 'The video has no picture to put a logo on.'
      : undefined;
  },

  fields: [
    {
      kind: 'select',
      key: 'position',
      label: 'Where',
      choices: [
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'center', label: 'In the middle' },
      ],
    },
    {
      kind: 'slider',
      key: 'size',
      label: 'Size',
      min: 5,
      max: 50,
      step: 1,
      display: (options) => `${options.size}% of the width`,
    },
    {
      kind: 'slider',
      key: 'opacity',
      label: 'Opacity',
      min: 10,
      max: 100,
      step: 5,
      display: (options) => `${options.opacity}%`,
      endLabels: ['Faint', 'Solid'],
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

  preflight: (_options, context) =>
    videoInput(context)?.info?.width === undefined
      ? ['The size of the video is still being read, so the logo is sized for 1280 px for now.']
      : [],

  build: (options, paths, context) => {
    // Without a context (the registry's smoke test) there is one entry per path.
    const aligned = paths.inputPaths.map((_path, index) => context.inputs?.[index]);
    return buildVideoWatermarkArgs(options, paths, aligned);
  },
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',
  outputDuration: (_options, context) => videoInput(context)?.info?.durationSeconds,

  estimateBytes: (_options, context) => {
    // Same frame, same length: the source's own bitrate is the best guess.
    const info = videoInput(context)?.info;
    if (info?.durationSeconds === undefined || info.bitrate === undefined) return undefined;
    return Math.round((info.bitrate / 8) * info.durationSeconds);
  },
});
