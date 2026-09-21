import {
  AUDIO_BITRATE_KBPS,
  AUDIO_ENCODERS,
  AUDIO_MIME,
  audioBytesPerSecond,
  isLossless,
  type AudioFormat,
} from './audio-extract';
import { defineOperation, type OperationContext } from './descriptor';

/**
 * Put several sound files together, either one after another (a playlist, a
 * podcast's segments) or on top of each other (a voice over a backing track).
 *
 * Like joining videos, the pieces rarely match: different sample rates,
 * mono next to stereo. Each one is brought to 48 kHz stereo before it meets
 * the others, which is what both `concat` and `amix` need.
 */

export type MergeMode = 'join' | 'mix';
export type MergeFormat = Exclude<AudioFormat, 'ogg'>;
export type MergeQuality = 'small' | 'good' | 'high';

export type AudioMergeOptions = {
  readonly mode: MergeMode;
  readonly format: MergeFormat;
  readonly quality: MergeQuality;
};

export const DEFAULT_MERGE: AudioMergeOptions = {
  mode: 'join',
  format: 'mp3',
  quality: 'good',
};

const LAYOUT = 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

export function mergeFilter(options: AudioMergeOptions, count: number): string {
  const chains: string[] = [];
  const pieces: string[] = [];
  for (let index = 0; index < count; index++) {
    chains.push(`[${index}:a:0]${LAYOUT}[a${index}]`);
    pieces.push(`[a${index}]`);
  }
  chains.push(
    options.mode === 'join'
      ? `${pieces.join('')}concat=n=${count}:v=0:a=1[a]`
      : // normalize=0 keeps every track at its own level; amix would otherwise
        // divide each by the number of tracks and the result comes out quiet.
        `${pieces.join('')}amix=inputs=${count}:duration=longest:normalize=0[a]`,
  );
  return chains.join(';');
}

export function buildAudioMergeArgs(
  options: AudioMergeOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
): string[] {
  const args: string[] = [];
  for (const path of paths.inputPaths) args.push('-i', path);
  args.push(
    '-filter_complex',
    mergeFilter(options, paths.inputPaths.length),
    '-map',
    '[a]',
    '-c:a',
    AUDIO_ENCODERS[options.format],
  );
  if (!isLossless(options.format)) {
    args.push('-b:a', `${AUDIO_BITRATE_KBPS[options.quality]}k`);
  }
  args.push(paths.outputPath);
  return args;
}

function durations(context: OperationContext): (number | undefined)[] {
  return context.inputs?.map((input) => input.info?.durationSeconds) ?? [];
}

export function mergedSeconds(
  mode: MergeMode,
  lengths: readonly (number | undefined)[],
): number | undefined {
  if (lengths.length === 0 || lengths.some((value) => value === undefined)) return undefined;
  const known = lengths as readonly number[];
  return mode === 'join' ? known.reduce((sum, value) => sum + value, 0) : Math.max(...known);
}

function silentInput(context: OperationContext): string | undefined {
  return context.inputs?.find((input) => input.info?.hasAudio === false)?.media.name;
}

export const audioMerge = defineOperation<AudioMergeOptions>({
  id: 'audio-merge',
  route: 'merge-audio',
  title: 'Merge audio',
  verb: 'Merge',
  summary: 'Join sound files one after another, or mix them together.',
  group: 'audio',
  accepts: ['audio'],
  inputs: { min: 2, max: 20 },
  defaults: DEFAULT_MERGE,
  outputSuffix: 'merged',

  rejects: (context) => {
    const silent = silentInput(context);
    return silent ? `${silent} has no sound in it.` : undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'mode',
      label: 'How',
      choices: [
        { value: 'join', label: 'One after another' },
        { value: 'mix', label: 'All at once' },
      ],
    },
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      choices: [
        { value: 'mp3', label: 'MP3', note: 'plays everywhere' },
        { value: 'm4a', label: 'M4A', note: 'AAC, good at small sizes' },
        { value: 'opus', label: 'Opus', note: 'best quality per byte' },
        { value: 'wav', label: 'WAV', note: 'uncompressed, large' },
        { value: 'flac', label: 'FLAC', note: 'lossless, compressed' },
      ],
    },
    {
      kind: 'select',
      key: 'quality',
      label: 'Quality',
      visibleWhen: (options) => !isLossless(options.format),
      choices: [
        { value: 'small', label: 'Smaller', note: '96 kbps' },
        { value: 'good', label: 'Good', note: '192 kbps' },
        { value: 'high', label: 'High', note: '320 kbps' },
      ],
    },
  ],

  preflight: (options) =>
    options.mode === 'mix'
      ? ['Every track keeps its own level, so loud tracks mixed together can clip.']
      : [],

  build: (options, paths) => buildAudioMergeArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => AUDIO_MIME[options.format],
  outputDuration: (options, context) => mergedSeconds(options.mode, durations(context)),

  estimateBytes: (options, context) => {
    const seconds = mergedSeconds(options.mode, durations(context));
    const perSecond = audioBytesPerSecond({ format: options.format, bitrate: options.quality });
    if (seconds === undefined || perSecond === undefined) return undefined;
    return Math.round(seconds * perSecond);
  },
});
