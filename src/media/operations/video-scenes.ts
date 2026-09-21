import { defineOperation } from './descriptor';

/**
 * A picture from the start of every shot: the first frame, then each frame
 * that looks very different from the one before it.
 *
 * How many pictures come out depends on the video, not on a setting, so the
 * estimate guesses a cut every few seconds. FFmpeg scores every frame for
 * this, which makes it slower than picking frames by time.
 */

export type SceneSensitivity = 'low' | 'medium' | 'high';
export type SceneFormat = 'jpg' | 'png';

export type VideoScenesOptions = {
  readonly sensitivity: SceneSensitivity;
  readonly format: SceneFormat;
  /** Largest width in pixels; smaller frames are left alone. */
  readonly width: number;
};

export const DEFAULT_SCENES: VideoScenesOptions = {
  sensitivity: 'medium',
  format: 'jpg',
  width: 1280,
};

/**
 * How different a frame must be from the last one, 0–1. Lower finds more
 * cuts, and at the bottom end it starts to take camera moves for cuts too.
 */
const THRESHOLDS: Readonly<Record<SceneSensitivity, number>> = {
  low: 0.45,
  medium: 0.3,
  high: 0.2,
};

/** For the estimate only: edited footage cuts roughly this often. */
const SECONDS_PER_SCENE = 5;

export function sceneFilter(options: VideoScenesOptions): string {
  const threshold = THRESHOLDS[options.sensitivity];
  return `select='eq(n,0)+gt(scene,${threshold})',scale='min(${options.width},iw)':-2`;
}

export function buildVideoScenesArgs(
  options: VideoScenesOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath, '-vf', sceneFilter(options), '-fps_mode', 'vfr', '-an'];
  if (options.format === 'jpg') args.push('-q:v', '2');
  args.push('-f', 'image2', paths.outputPath);
  return args;
}

export const videoScenes = defineOperation<VideoScenesOptions>({
  id: 'video-scenes',
  route: 'scenes',
  title: 'Scene thumbnails',
  verb: 'Find scenes',
  summary: 'Save a picture from the start of every shot in a video.',
  group: 'image',
  accepts: ['video'],
  outputs: 'many',
  defaults: DEFAULT_SCENES,
  outputSuffix: 'scene',

  rejects: (context) =>
    context.info?.hasVideo === false
      ? 'This file has no picture to look for scenes in.'
      : undefined,

  fields: [
    {
      kind: 'segmented',
      key: 'sensitivity',
      label: 'Sensitivity',
      hint: 'Higher finds more cuts, and may mistake a quick camera move for one.',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
    },
    {
      kind: 'segmented',
      key: 'format',
      label: 'Format',
      choices: [
        { value: 'jpg', label: 'JPG', note: 'small' },
        { value: 'png', label: 'PNG', note: 'lossless' },
      ],
    },
    {
      kind: 'select',
      key: 'width',
      label: 'Width',
      choices: [
        { value: 1920, label: 'Up to 1920 px' },
        { value: 1280, label: 'Up to 1280 px' },
        { value: 640, label: 'Up to 640 px' },
      ],
    },
  ],

  build: (options, paths) => buildVideoScenesArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => (options.format === 'png' ? 'image/png' : 'image/jpeg'),

  estimateBytes: (options, context) => {
    const info = context.info;
    if (info?.durationSeconds === undefined || !info.width || !info.height) return undefined;
    const width = Math.min(options.width, info.width);
    const pixels = width * Math.round((width * info.height) / info.width);
    const count = Math.ceil(info.durationSeconds / SECONDS_PER_SCENE);
    return Math.round(count * pixels * (options.format === 'png' ? 1.5 : 0.2));
  },
});
