import { defineOperation } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Change how many frames a second the video runs at.
 *
 * Two ways to get there. `fps` drops or repeats whole frames, which is instant
 * and what you want for making a file smaller or meeting a platform's limit.
 * `minterpolate` invents the frames in between, which is what makes 30 into 60
 * look genuinely smooth — and is slow enough to need saying out loud.
 */

export type VideoFpsOptions = {
  readonly fps: number | undefined;
  readonly smooth: boolean;
  readonly quality: number;
};

export const DEFAULT_FPS: VideoFpsOptions = {
  fps: 30,
  smooth: false,
  quality: 60,
};

const MIN_FPS = 1;
const MAX_FPS = 240;

export function clampFps(fps: number | undefined): number | undefined {
  if (fps === undefined || Number.isNaN(fps) || fps <= 0) return undefined;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, fps));
}

export function fpsFilter(options: VideoFpsOptions): string | undefined {
  const fps = clampFps(options.fps);
  if (fps === undefined) return undefined;

  // mci reads motion between frames; without it minterpolate just blends.
  return options.smooth ? `minterpolate=fps=${fps}:mi_mode=mci` : `fps=${fps}`;
}

export function buildVideoFpsArgs(
  options: VideoFpsOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath];

  const filter = fpsFilter(options);
  if (filter) args.push('-vf', filter);

  args.push(...h264OutputArgs({ quality: options.quality, audio: 'copy' }), paths.outputPath);
  return args;
}

export const videoFps = defineOperation<VideoFpsOptions>({
  id: 'video-fps',
  route: 'frame-rate',
  title: 'Change frame rate',
  verb: 'Change frame rate',
  summary: 'Run a video at a different number of frames a second.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_FPS,
  outputSuffix: 'fps',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to re-time.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'fps',
      label: 'Frames a second',
      choices: (_options, context) => {
        const source = context.info?.frameRate;
        return [15, 24, 25, 30, 50, 60].map((fps) => ({
          value: fps,
          label: String(fps),
          note:
            source !== undefined && Math.abs(source - fps) < 0.5
              ? 'what it is now'
              : FPS_NOTES[fps as keyof typeof FPS_NOTES],
        }));
      },
    },
    {
      kind: 'number',
      key: 'fps',
      label: 'Or type a number',
      suffix: 'fps',
      min: MIN_FPS,
      max: MAX_FPS,
      step: 1,
      placeholder: '30',
    },
    {
      kind: 'toggle',
      key: 'smooth',
      label: 'Invent the frames in between',
      hint: 'Smoother than repeating frames, and far slower — minutes rather than seconds.',
      warnWhen: (options, context) => {
        const target = clampFps(options.fps);
        const source = context.info?.frameRate;
        if (!options.smooth) return undefined;
        if (target !== undefined && source !== undefined && target <= source) {
          return 'Inventing frames only helps when going up. This is going down, where plain frame dropping is both faster and better.';
        }
        return 'This runs the motion estimator over every frame. Expect it to take many times longer than the video is long.';
      },
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
    const target = clampFps(options.fps);
    const source = context.info?.frameRate;

    if (target === undefined) {
      warnings.push('Fill in a frame rate, or the video comes out the way it went in.');
    } else if (source !== undefined && Math.abs(source - target) < 0.5) {
      warnings.push('That is the frame rate it already runs at, so nothing would change.');
    }
    return warnings;
  },

  build: (options, paths) => buildVideoFpsArgs(options, paths),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    const bitrate = context.info?.bitrate;
    const target = clampFps(options.fps);
    const source = context.info?.frameRate;
    if (duration === undefined || bitrate === undefined) return undefined;

    // Fewer frames a second is roughly proportionally fewer bytes, but not
    // entirely — a still frame costs almost nothing either way.
    const ratio = target !== undefined && source ? Math.min(1.5, target / source) : 1;
    const scaled = bitrate * (0.4 + 0.6 * ratio);
    return Math.round((scaled / 8) * duration);
  },
});

const FPS_NOTES = {
  15: 'small files',
  24: 'film',
  25: 'PAL',
  30: 'the usual',
  50: 'smooth',
  60: 'very smooth',
} as const;
