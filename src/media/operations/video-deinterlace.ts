import { defineOperation } from './descriptor';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Remove the comb-like stripes from interlaced footage — old camcorders,
 * broadcast recordings, DVDs.
 *
 * `bwdif` is the better of the two deinterlacers in the core (`yadif` is the
 * other). It runs on every frame (`deint=all`) rather than only the ones
 * flagged as interlaced, because a flag is exactly the kind of thing old
 * footage gets wrong. Each interlaced frame holds two moments; keeping the
 * frame rate throws one away, doubling it keeps both and moves more smoothly.
 */

export type DeinterlaceRate = 'same' | 'double';

export type VideoDeinterlaceOptions = {
  readonly rate: DeinterlaceRate;
  readonly quality: number;
};

export const DEFAULT_DEINTERLACE: VideoDeinterlaceOptions = {
  rate: 'same',
  quality: 60,
};

export function deinterlaceFilter(options: VideoDeinterlaceOptions): string {
  const mode = options.rate === 'double' ? 'send_field' : 'send_frame';
  return `bwdif=mode=${mode}:deint=all`;
}

export function buildVideoDeinterlaceArgs(
  options: VideoDeinterlaceOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-vf',
    deinterlaceFilter(options),
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  ];
}

export const videoDeinterlace = defineOperation<VideoDeinterlaceOptions>({
  id: 'video-deinterlace',
  route: 'deinterlace',
  title: 'Deinterlace',
  verb: 'Deinterlace',
  summary: 'Remove the fine horizontal stripes from old camcorder or TV footage.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_DEINTERLACE,
  outputSuffix: 'deinterlaced',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to deinterlace.' : undefined,

  fields: [
    {
      kind: 'segmented',
      key: 'rate',
      label: 'Motion',
      choices: [
        { value: 'same', label: 'Same frame rate' },
        { value: 'double', label: 'Smoother' },
      ],
      hint: 'Smoother doubles the frame rate so no moment is thrown away. The file gets bigger.',
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

  build: (options, paths) => buildVideoDeinterlaceArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const same = sameSizeEstimate(context.info);
    if (same === undefined) return undefined;
    // Twice the frames, but neighbouring frames are close, so well short of twice the bytes.
    return options.rate === 'double' ? Math.round(same * 1.4) : same;
  },
});
