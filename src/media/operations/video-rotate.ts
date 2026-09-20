import { defineOperation } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Turn a video the right way up, or mirror it.
 *
 * The usual reason is a phone clip that a player has read the wrong way. This
 * re-encodes rather than editing the rotation flag, because a flag is what got
 * the file into trouble in the first place — half the players honour it, half
 * ignore it. Turning the pixels themselves is the version that always works.
 */

export type Turn = 'none' | 'right' | 'left' | 'half';
export type Mirror = 'none' | 'horizontal' | 'vertical';

export type VideoRotateOptions = {
  readonly turn: Turn;
  readonly mirror: Mirror;
  readonly quality: number;
};

export const DEFAULT_ROTATE: VideoRotateOptions = {
  turn: 'right',
  mirror: 'none',
  quality: 60,
};

/**
 * `transpose=1` is a quarter turn clockwise, `2` anticlockwise; a half turn is
 * two of them. `hflip` and `vflip` mirror without turning.
 */
export function rotateFilter(options: VideoRotateOptions): string | undefined {
  const steps: string[] = [];

  switch (options.turn) {
    case 'right':
      steps.push('transpose=1');
      break;
    case 'left':
      steps.push('transpose=2');
      break;
    case 'half':
      steps.push('transpose=1', 'transpose=1');
      break;
    case 'none':
      break;
  }

  if (options.mirror === 'horizontal') steps.push('hflip');
  if (options.mirror === 'vertical') steps.push('vflip');

  return steps.length ? steps.join(',') : undefined;
}

/** A quarter turn swaps the sides; everything else leaves them as they were. */
export function swapsDimensions(options: VideoRotateOptions): boolean {
  return options.turn === 'right' || options.turn === 'left';
}

export function buildVideoRotateArgs(
  options: VideoRotateOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath];

  const filter = rotateFilter(options);
  if (filter) args.push('-vf', filter);

  args.push(...h264OutputArgs({ quality: options.quality, audio: 'copy' }), paths.outputPath);
  return args;
}

export const videoRotate = defineOperation<VideoRotateOptions>({
  id: 'video-rotate',
  route: 'rotate',
  title: 'Rotate or flip',
  verb: 'Rotate',
  summary: 'Turn a video a quarter or a half turn, or mirror it.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_ROTATE,
  outputSuffix: 'rotated',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to turn.' : undefined,

  fields: [
    {
      kind: 'segmented',
      key: 'turn',
      label: 'Turn',
      choices: [
        { value: 'none', label: 'None' },
        { value: 'right', label: 'Right' },
        { value: 'left', label: 'Left' },
        { value: 'half', label: 'Upside down' },
      ],
    },
    {
      kind: 'segmented',
      key: 'mirror',
      label: 'Mirror',
      hint: 'Flips the picture without turning it — useful for selfie footage.',
      choices: [
        { value: 'none', label: 'None' },
        { value: 'horizontal', label: 'Left to right' },
        { value: 'vertical', label: 'Top to bottom' },
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

  preflight: (options) =>
    options.turn === 'none' && options.mirror === 'none'
      ? ['Nothing is being turned or mirrored, so this would re-encode the video for no reason.']
      : [],

  build: (options, paths) => buildVideoRotateArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    // The picture is the same size whichever way up it is, so the source's own
    // bitrate is the best guess available.
    const duration = context.info?.durationSeconds;
    const bitrate = context.info?.bitrate;
    if (duration === undefined || bitrate === undefined) return undefined;
    return Math.round((bitrate / 8) * duration);
  },
});
