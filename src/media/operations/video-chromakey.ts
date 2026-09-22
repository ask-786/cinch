import type { MediaKind } from '../models/media-kind';
import { defineOperation, type OperationContext, type OperationInput } from './descriptor';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';
import { vp8CeilingKbps, vp8Crf, vp8QualityArgs } from './vp8-output';

/**
 * Take out a green (or blue) screen.
 *
 * With a picture alongside the video, the picture becomes the new background,
 * enlarged to cover the frame. Without one, the result is a WebM with a real
 * transparent background, for dropping into an editor — MP4 and H.264 have no
 * way to carry transparency, VP8 in WebM does (see vp8-output for why not
 * VP9). VP8 refuses alpha unless alt-ref frames are off.
 *
 * The picture is looped into a clip at the video's own frame rate. Left to its
 * default of 25 it would set the pace for `overlay`, and a 30 fps video would
 * come out at 25 (measured).
 */

export type KeyColor = 'green' | 'blue';

export type VideoChromakeyOptions = {
  readonly color: KeyColor;
  /** How far from the key colour still counts as screen, 1–50. */
  readonly strength: number;
  /** How gradually the edges fade, 0–20. */
  readonly softness: number;
  readonly quality: number;
};

export const DEFAULT_CHROMAKEY: VideoChromakeyOptions = {
  color: 'green',
  strength: 20,
  softness: 5,
  quality: 60,
};

/** The broadcast chroma-key shades, which real screens are painted close to. */
export const KEY_HEX: Readonly<Record<KeyColor, string>> = {
  green: '0x00B140',
  blue: '0x0047BB',
};

/** When the video's size or rate is still being read. */
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const FALLBACK_FPS = 30;

const OPUS_KBPS = 128;

/** Which input is the video and which, if any, the background. */
export function chromakeyRoles(kinds: readonly (MediaKind | undefined)[]): {
  video: number;
  background?: number;
} {
  if (kinds.length < 2) return { video: 0 };
  return kinds[0] === 'image' ? { video: 1, background: 0 } : { video: 0, background: 1 };
}

export function keyFilter(options: VideoChromakeyOptions): string {
  const similarity = (options.strength / 100).toFixed(2);
  const blend = (options.softness / 100).toFixed(2);
  return `chromakey=${KEY_HEX[options.color]}:${similarity}:${blend}`;
}

function videoInput(context: OperationContext): OperationInput | undefined {
  const inputs = context.inputs ?? [];
  return inputs[chromakeyRoles(inputs.map((input) => input.media.kind)).video];
}

function hasBackground(context: OperationContext): boolean {
  return (context.inputs?.length ?? 0) > 1;
}

export function buildVideoChromakeyArgs(
  options: VideoChromakeyOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  inputs: readonly (OperationInput | undefined)[],
): string[] {
  const roles = chromakeyRoles(inputs.map((input) => input?.media.kind));
  const video = inputs[roles.video]?.info;
  const args: string[] = [];

  paths.inputPaths.forEach((path, index) => {
    if (index === roles.background) {
      // -loop and -framerate are input options: they turn one picture into a clip.
      const fps = video?.frameRate ?? FALLBACK_FPS;
      args.push('-loop', '1', '-framerate', String(Number(fps.toFixed(3))));
    }
    args.push('-i', path);
  });

  if (roles.background === undefined) {
    args.push('-vf', keyFilter(options));
    args.push(
      ...vp8QualityArgs(options.quality, video),
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-c:a',
      'libopus',
      '-b:a',
      `${OPUS_KBPS}k`,
      paths.outputPath,
    );
    return args;
  }

  const width = video?.width ?? FALLBACK_WIDTH;
  const height = video?.height ?? FALLBACK_HEIGHT;
  args.push(
    '-filter_complex',
    `[${roles.background}:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}[bg];` +
      `[${roles.video}:v:0]${keyFilter(options)}[fg];` +
      // The looped picture never ends, so the video's end is the output's.
      `[bg][fg]overlay=shortest=1,format=yuv420p[v]`,
    '-map',
    '[v]',
    // `?`: a silent video simply has no sound to carry across.
    '-map',
    `${roles.video}:a:0?`,
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  );
  return args;
}

export const videoChromakey = defineOperation<VideoChromakeyOptions>({
  id: 'video-chromakey',
  route: 'green-screen',
  title: 'Remove a green screen',
  verb: 'Remove screen',
  summary: 'Swap a green or blue background for a picture, or make it transparent.',
  group: 'video',
  accepts: ['video', 'image'],
  inputs: { min: 1, max: 2 },
  requires: ['video'],
  defaults: DEFAULT_CHROMAKEY,
  outputSuffix: 'keyed',

  rejects: (context) => {
    const kinds = context.inputs?.map((input) => input.media.kind) ?? [];
    if (kinds.length === 2 && !(kinds.includes('video') && kinds.includes('image'))) {
      return 'This takes one video, and optionally one picture to put behind it.';
    }
    return videoInput(context)?.info?.hasVideo === false
      ? 'The video has no picture to key.'
      : undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'color',
      label: 'Screen colour',
      choices: [
        { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' },
      ],
    },
    {
      kind: 'slider',
      key: 'strength',
      label: 'Strength',
      min: 1,
      max: 50,
      step: 1,
      endLabels: ['Only the exact colour', 'Nearby shades too'],
      hint: 'Raise it if patches of screen are left behind; lower it if the subject starts to disappear.',
    },
    {
      kind: 'slider',
      key: 'softness',
      label: 'Edge softness',
      min: 0,
      max: 20,
      step: 1,
      endLabels: ['Hard edges', 'Soft edges'],
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      min: 0,
      max: 100,
      step: 1,
      endLabels: ['Smaller file', 'Better picture'],
      display: (options, context) =>
        `${options.quality} · CRF ${hasBackground(context) ? qualityToCrf(options.quality, 'h264') : vp8Crf(options.quality)}`,
    },
  ],

  preflight: (_options, context) => {
    const warnings: string[] = [];
    if (!hasBackground(context)) {
      warnings.push(
        'With no picture to put behind it, the background is made transparent. That needs a WebM file, which most editors accept but some phones will not play.',
      );
    } else if (videoInput(context)?.info?.width === undefined) {
      warnings.push(
        'The size of the video is still being read, so the background is sized for 1280 × 720 for now.',
      );
    }
    return warnings;
  },

  build: (options, paths, context) => {
    // Without a context (the registry's smoke test) there is one entry per path.
    const aligned = paths.inputPaths.map((_path, index) => context.inputs?.[index]);
    return buildVideoChromakeyArgs(options, paths, aligned);
  },
  outputExtension: (_options, context) => (hasBackground(context) ? 'mp4' : 'webm'),
  outputMime: (_options, context) => (hasBackground(context) ? 'video/mp4' : 'video/webm'),
  outputDuration: (_options, context) => videoInput(context)?.info?.durationSeconds,

  estimateBytes: (_options, context) => {
    const info = videoInput(context)?.info;
    if (hasBackground(context)) return sameSizeEstimate(info);
    // The ceiling is the size: the source's bitrate says little about VP8's.
    // The alpha plane is a second VP8 stream under the same cap, so busy
    // footage can reach twice it (measured: 3.8 Mb/s against 1.9 on a 720×1280 clip).
    if (info?.durationSeconds === undefined) return undefined;
    const kbps = 2 * vp8CeilingKbps(info) + OPUS_KBPS;
    return Math.round((kbps * 1000 * info.durationSeconds) / 8);
  },
});
