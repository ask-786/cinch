import type { MediaInfo } from '../models/media-info';
import { defineOperation, type OperationInput } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { DEFAULT_COMPRESSION, estimateOutputBytes, qualityToCrf } from './video-compress';

/**
 * Play several clips one after another, as one file.
 *
 * FFmpeg's `concat` filter insists every piece has the same frame size, frame
 * rate, pixel format and audio layout — clips off two different phones never
 * do. So each input is first fitted into one frame (scaled, then padded with
 * black rather than stretched) and its sound resampled, and only then joined.
 * That means a re-encode, but it is the version that works on real files.
 */

export type JoinSize = 'first' | '1080' | '720' | '480';

export type VideoJoinOptions = {
  readonly size: JoinSize;
  readonly quality: number;
};

export const DEFAULT_JOIN: VideoJoinOptions = {
  size: 'first',
  quality: 60,
};

/** When nothing is known about the first clip yet. */
const FALLBACK_HEIGHT = 720;
const FALLBACK_FRAME_RATE = 30;

/**
 * How the sound is joined. Clips without a sound track are the snag: the
 * filter needs audio from every piece or from none.
 *
 * - `all`  — every clip has sound (or we have no reason to think otherwise)
 * - `fill` — some are silent, so those get generated silence of their length
 * - `none` — no sound at all, either because no clip has any or because a
 *            silent clip's length is unknown and silence cannot be sized
 */
export type JoinAudio = 'all' | 'fill' | 'none';

export function joinAudio(infos: readonly (MediaInfo | undefined)[]): JoinAudio {
  const silent = infos.filter((info) => info?.hasAudio === false);
  if (silent.length === 0) return 'all';
  if (silent.length === infos.length) return 'none';
  return silent.every((info) => info?.durationSeconds !== undefined) ? 'fill' : 'none';
}

/** The frame every clip is fitted into. Always even: H.264 with 4:2:0 insists. */
export function joinFrame(
  options: VideoJoinOptions,
  first: MediaInfo | undefined,
): { width: number; height: number } {
  const aspect = first?.width && first?.height ? first.width / first.height : 16 / 9;
  const height =
    options.size === 'first' ? (first?.height ?? FALLBACK_HEIGHT) : Number(options.size);
  return { width: even(height * aspect), height: even(height) };
}

export function joinFrameRate(first: MediaInfo | undefined): number {
  const rate = first?.frameRate;
  // Variable-rate phone footage can report 29.97 or 59.94 — both keep fine.
  return rate && rate > 0 && rate <= 120 ? Math.round(rate * 1000) / 1000 : FALLBACK_FRAME_RATE;
}

export function joinFilter(
  options: VideoJoinOptions,
  inputs: readonly (MediaInfo | undefined)[],
): { graph: string; audio: JoinAudio } {
  const { width, height } = joinFrame(options, inputs[0]);
  const fps = joinFrameRate(inputs[0]);
  const audio = joinAudio(inputs);

  const chains: string[] = [];
  const pieces: string[] = [];

  inputs.forEach((info, index) => {
    chains.push(
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`,
    );
    pieces.push(`[v${index}]`);

    if (audio === 'none') return;
    const layout = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    if (info?.hasAudio === false) {
      chains.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${info.durationSeconds},${layout}[a${index}]`,
      );
    } else {
      chains.push(`[${index}:a:0]aresample=48000,${layout}[a${index}]`);
    }
    pieces.push(`[a${index}]`);
  });

  const withSound = audio === 'none' ? 0 : 1;
  chains.push(
    `${pieces.join('')}concat=n=${inputs.length}:v=1:a=${withSound}[v]${withSound ? '[a]' : ''}`,
  );

  return { graph: chains.join(';'), audio };
}

export function buildVideoJoinArgs(
  options: VideoJoinOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  inputs: readonly (MediaInfo | undefined)[],
): string[] {
  const args: string[] = [];
  for (const path of paths.inputPaths) args.push('-i', path);

  const { graph, audio } = joinFilter(options, inputs);
  args.push('-filter_complex', graph, '-map', '[v]');
  if (audio !== 'none') args.push('-map', '[a]');

  args.push(
    ...h264OutputArgs({ quality: options.quality, audio: audio === 'none' ? 'drop' : 'reencode' }),
    paths.outputPath,
  );
  return args;
}

function infosOf(inputs: readonly OperationInput[] | undefined): (MediaInfo | undefined)[] {
  return inputs?.map((input) => input.info) ?? [];
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export const videoJoin = defineOperation<VideoJoinOptions>({
  id: 'video-join',
  route: 'join',
  title: 'Join videos',
  verb: 'Join',
  summary: 'Play several clips one after another, as one video.',
  group: 'video',
  accepts: ['video'],
  inputs: { min: 2, max: 20 },
  defaults: DEFAULT_JOIN,
  outputSuffix: 'joined',

  rejects: (context) => {
    const blind = context.inputs?.find((input) => input.info?.hasVideo === false);
    return blind ? `${blind.media.name} has no picture to join.` : undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'size',
      label: 'Frame size',
      hint: 'Clips of a different shape get black bars rather than being stretched.',
      choices: [
        { value: 'first', label: 'Like the first clip' },
        { value: '1080', label: '1080p' },
        { value: '720', label: '720p' },
        { value: '480', label: '480p' },
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

  preflight: (_options, context) => {
    const infos = infosOf(context.inputs);
    const warnings: string[] = [];
    if (infos.some((info) => info?.hasAudio === false) && joinAudio(infos) === 'none') {
      warnings.push(
        infos.every((info) => info?.hasAudio === false)
          ? 'None of these clips has sound, so the result will be silent.'
          : 'One of the clips has no sound and its length is still being read, so for now the result would be silent.',
      );
    }
    if (infos.some((info) => info === undefined)) {
      warnings.push('Some of these clips are still being read.');
    }
    return warnings;
  },

  build: (options, paths, context) => {
    const infos = infosOf(context.inputs);
    // Without a context (the registry's smoke test) there is one info per path.
    const aligned = paths.inputPaths.map((_path, index) => infos[index]);
    return buildVideoJoinArgs(options, paths, aligned);
  },
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  outputDuration: (_options, context) => totalDuration(infosOf(context.inputs)),

  // Without an estimate the job falls back to the slow single-threaded core,
  // so this is worth having even though it is rough.
  estimateBytes: (options, context) => {
    const infos = infosOf(context.inputs);
    const durationSeconds = totalDuration(infos);
    if (durationSeconds === undefined) return undefined;
    const frame = joinFrame(options, infos[0]);
    return estimateOutputBytes(
      {
        ...DEFAULT_COMPRESSION,
        quality: options.quality,
        // The join re-encodes sound at 192k, compression's "high".
        audio: joinAudio(infos) === 'none' ? 'none' : 'high',
      },
      {
        source: 'ffprobe',
        kind: 'video',
        durationSeconds,
        ...frame,
        frameRate: joinFrameRate(infos[0]),
      },
    );
  },
});

function totalDuration(infos: readonly (MediaInfo | undefined)[]): number | undefined {
  const durations = infos.map((info) => info?.durationSeconds);
  if (durations.length === 0 || durations.some((value) => value === undefined)) return undefined;
  return durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
