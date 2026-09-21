import type { MediaInfo } from '../models/media-info';
import { defineOperation, type OperationContext } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { joinFrameRate } from './video-join';
import { DEFAULT_COMPRESSION, estimateOutputBytes, qualityToCrf } from './video-compress';

/**
 * Show several clips at once: two side by side, one above the other, or a
 * grid — a before-and-after, a reaction, a wall of camera angles.
 *
 * Every clip is fitted into the same cell first, scaled and then padded with
 * black the way join does it, because `hstack` and `xstack` need matching
 * sides and phone footage never has them. A grid that is not full gets black
 * cells, made from the first clip so they last exactly as long as it does; a
 * generated colour source would never end and neither would the job.
 */

export type StackLayout = 'row' | 'column' | 'grid';
export type StackSize = '360' | '540' | '720';
export type StackLength = 'longest' | 'shortest';
export type StackSound = 'first' | 'mix' | 'none';

export type VideoStackOptions = {
  readonly layout: StackLayout;
  /** Height of one cell. */
  readonly size: StackSize;
  readonly length: StackLength;
  readonly sound: StackSound;
  readonly quality: number;
};

export const DEFAULT_STACK: VideoStackOptions = {
  layout: 'row',
  size: '540',
  length: 'longest',
  sound: 'first',
  quality: 60,
};

/** Past this, most screens and many players give up. */
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;

export function stackShape(layout: StackLayout, count: number): { columns: number; rows: number } {
  switch (layout) {
    case 'row':
      return { columns: count, rows: 1 };
    case 'column':
      return { columns: 1, rows: count };
    case 'grid': {
      const columns = Math.ceil(Math.sqrt(count));
      return { columns, rows: Math.ceil(count / columns) };
    }
  }
}

/** One cell, shaped like the first clip. Always even: H.264 with 4:2:0 insists. */
export function stackCell(
  options: VideoStackOptions,
  first: MediaInfo | undefined,
): { width: number; height: number } {
  const aspect = first?.width && first?.height ? first.width / first.height : 16 / 9;
  const height = Number(options.size);
  return { width: even(height * aspect), height };
}

export function stackFrame(
  options: VideoStackOptions,
  inputs: readonly (MediaInfo | undefined)[],
): { width: number; height: number } {
  const cell = stackCell(options, inputs[0]);
  const { columns, rows } = stackShape(options.layout, inputs.length);
  return { width: cell.width * columns, height: cell.height * rows };
}

/** Which inputs the sound comes from. A clip known to be silent never counts. */
export function stackSoundSources(
  sound: StackSound,
  inputs: readonly (MediaInfo | undefined)[],
): number[] {
  const voiced = inputs.flatMap((info, index) => (info?.hasAudio === false ? [] : [index]));
  if (sound === 'none') return [];
  return sound === 'first' ? voiced.slice(0, 1) : voiced;
}

export function stackFilter(
  options: VideoStackOptions,
  inputs: readonly (MediaInfo | undefined)[],
): string {
  const { width, height } = stackCell(options, inputs[0]);
  const fps = joinFrameRate(inputs[0]);
  const { columns, rows } = stackShape(options.layout, inputs.length);
  const blanks = columns * rows - inputs.length;
  const shortest = options.length === 'shortest' ? 1 : 0;

  const chains: string[] = [];
  inputs.forEach((_info, index) => {
    const label = index === 0 && blanks > 0 ? 'first' : `t${index}`;
    chains.push(
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[${label}]`,
    );
  });

  const tiles = inputs.map((_info, index) => `[t${index}]`);
  if (blanks > 0) {
    const copies = Array.from({ length: blanks }, (_, index) => `[c${index}]`);
    chains.push(`[first]split=${blanks + 1}[t0]${copies.join('')}`);
    copies.forEach((copy, index) => {
      chains.push(`${copy}drawbox=c=black:t=fill[b${index}]`);
      tiles.push(`[b${index}]`);
    });
  }

  if (options.layout === 'grid') {
    const layout = tiles
      .map((_tile, index) => `${(index % columns) * width}_${Math.floor(index / columns) * height}`)
      .join('|');
    chains.push(
      `${tiles.join('')}xstack=inputs=${tiles.length}:layout=${layout}:shortest=${shortest}[v]`,
    );
  } else {
    const filter = options.layout === 'row' ? 'hstack' : 'vstack';
    chains.push(`${tiles.join('')}${filter}=inputs=${tiles.length}:shortest=${shortest}[v]`);
  }

  const sources = stackSoundSources(options.sound, inputs);
  if (sources.length > 1) {
    const duration = options.length === 'shortest' ? 'shortest' : 'longest';
    chains.push(
      `${sources.map((index) => `[${index}:a:0]`).join('')}` +
        `amix=inputs=${sources.length}:duration=${duration}:normalize=0[a]`,
    );
  }

  return chains.join(';');
}

export function buildVideoStackArgs(
  options: VideoStackOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  inputs: readonly (MediaInfo | undefined)[],
): string[] {
  const args: string[] = [];
  for (const path of paths.inputPaths) args.push('-i', path);
  args.push('-filter_complex', stackFilter(options, inputs), '-map', '[v]');

  const sources = stackSoundSources(options.sound, inputs);
  if (sources.length > 1) args.push('-map', '[a]');
  if (sources.length === 1) args.push('-map', `${sources[0]}:a:0`);

  args.push(
    ...h264OutputArgs({
      quality: options.quality,
      // Re-encoded even when it comes from one clip: an MKV's Vorbis sound
      // would not go into the MP4 as it is.
      audio: sources.length === 0 ? 'drop' : 'reencode',
    }),
  );
  // The picture stops at the shortest clip; one clip's sound track would not.
  if (options.length === 'shortest' && sources.length === 1) args.push('-shortest');
  args.push(paths.outputPath);
  return args;
}

function infosOf(context: OperationContext): (MediaInfo | undefined)[] {
  return context.inputs?.map((input) => input.info) ?? [];
}

function stackSeconds(
  options: VideoStackOptions,
  infos: readonly (MediaInfo | undefined)[],
): number | undefined {
  const durations = infos.map((info) => info?.durationSeconds);
  if (durations.length === 0 || durations.some((value) => value === undefined)) return undefined;
  const known = durations as number[];
  return options.length === 'shortest' ? Math.min(...known) : Math.max(...known);
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export const videoStack = defineOperation<VideoStackOptions>({
  id: 'video-stack',
  route: 'stack',
  title: 'Side by side or grid',
  verb: 'Combine',
  summary: 'Play several clips at once, next to each other or in a grid.',
  group: 'video',
  accepts: ['video'],
  inputs: { min: 2, max: 9 },
  defaults: DEFAULT_STACK,
  outputSuffix: 'stacked',

  rejects: (context) => {
    const blind = context.inputs?.find((input) => input.info?.hasVideo === false);
    return blind ? `${blind.media.name} has no picture to show.` : undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'layout',
      label: 'Layout',
      choices: [
        { value: 'row', label: 'Side by side' },
        { value: 'column', label: 'One above the other' },
        { value: 'grid', label: 'Grid' },
      ],
    },
    {
      kind: 'segmented',
      key: 'size',
      label: 'Each clip',
      hint: 'Clips of a different shape get black bars rather than being stretched.',
      choices: [
        { value: '360', label: '360p' },
        { value: '540', label: '540p' },
        { value: '720', label: '720p' },
      ],
    },
    {
      kind: 'segmented',
      key: 'length',
      label: 'Length',
      hint: 'A clip that ends early holds its last frame.',
      choices: [
        { value: 'longest', label: 'Until the last clip ends' },
        { value: 'shortest', label: 'Until the first clip ends' },
      ],
    },
    {
      kind: 'segmented',
      key: 'sound',
      label: 'Sound',
      choices: [
        { value: 'first', label: 'First clip' },
        { value: 'mix', label: 'All of them' },
        { value: 'none', label: 'None' },
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
    const infos = infosOf(context);
    const warnings: string[] = [];
    const frame = stackFrame(options, infos);
    if (frame.width > MAX_WIDTH || frame.height > MAX_HEIGHT) {
      warnings.push(
        `The result would be ${frame.width}×${frame.height}, bigger than 4K. A smaller size per clip, or a grid, keeps it playable.`,
      );
    }
    if (options.sound !== 'none' && stackSoundSources(options.sound, infos).length === 0) {
      warnings.push('None of these clips has sound, so the result will be silent.');
    }
    if (infos.some((info) => info === undefined)) {
      warnings.push('Some of these clips are still being read.');
    }
    return warnings;
  },

  build: (options, paths, context) => {
    const infos = infosOf(context);
    // Without a context (the registry's smoke test) there is one info per path.
    const aligned = paths.inputPaths.map((_path, index) => infos[index]);
    return buildVideoStackArgs(options, paths, aligned);
  },
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',
  outputDuration: (options, context) => stackSeconds(options, infosOf(context)),

  // Without an estimate the job falls back to the slow single-threaded core.
  estimateBytes: (options, context) => {
    const infos = infosOf(context);
    const durationSeconds = stackSeconds(options, infos);
    if (durationSeconds === undefined) return undefined;
    return estimateOutputBytes(
      {
        ...DEFAULT_COMPRESSION,
        quality: options.quality,
        audio: stackSoundSources(options.sound, infos).length === 0 ? 'none' : 'high',
      },
      {
        source: 'ffprobe',
        kind: 'video',
        durationSeconds,
        ...stackFrame(options, infos),
        frameRate: joinFrameRate(infos[0]),
      },
    );
  },
});
