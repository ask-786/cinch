import { AUDIO_MIME, audioCodecArgs, isLossless, type AudioFormat } from './audio-extract';
import { defineOperation, type OperationContext } from './descriptor';
import { soundFormat } from './sound-output';

/**
 * Re-encode a sound file at a chosen bitrate, sample rate and channel count —
 * to fit a size limit, suit a device that wants 44.1 kHz, or fold stereo to
 * mono for a voice recording.
 *
 * Extract audio covers the everyday "make it an MP3"; this is the one that
 * exposes the numbers. Measured on the core: libopus refuses anything but
 * 48 kHz and LAME refuses anything above 48 kHz, so only the rates every
 * format accepts are offered, and Opus is not offered one at all.
 */

export type ResampleFormat = 'same' | AudioFormat;
export type ResampleChannels = 'keep' | 'mono' | 'stereo';

export type AudioResampleOptions = {
  readonly format: ResampleFormat;
  readonly kbps: number;
  /** 0 keeps the source's own rate. */
  readonly sampleRate: number;
  readonly channels: ResampleChannels;
};

export const DEFAULT_RESAMPLE: AudioResampleOptions = {
  format: 'same',
  kbps: 128,
  sampleRate: 0,
  channels: 'keep',
};

const FORMAT_LABELS: Readonly<Record<AudioFormat, string>> = {
  mp3: 'MP3',
  m4a: 'M4A',
  opus: 'Opus',
  wav: 'WAV',
  flac: 'FLAC',
  ogg: 'OGG',
};

export function resolvedFormat(
  options: AudioResampleOptions,
  context: OperationContext,
): AudioFormat {
  return options.format === 'same' ? soundFormat(context) : options.format;
}

export function buildAudioResampleArgs(
  options: AudioResampleOptions,
  paths: { inputPath: string; outputPath: string },
  context: OperationContext,
): string[] {
  const format = resolvedFormat(options, context);
  const args = ['-i', paths.inputPath, '-vn', ...audioCodecArgs(format)];

  if (!isLossless(format)) args.push('-b:a', `${options.kbps}k`);
  if (options.sampleRate > 0 && format !== 'opus') args.push('-ar', String(options.sampleRate));
  if (options.channels !== 'keep') args.push('-ac', options.channels === 'mono' ? '1' : '2');

  args.push(paths.outputPath);
  return args;
}

function channelCount(options: AudioResampleOptions, context: OperationContext): number {
  if (options.channels === 'mono') return 1;
  if (options.channels === 'stereo') return 2;
  return context.info?.channels ?? 2;
}

function bytesPerSecond(options: AudioResampleOptions, context: OperationContext): number {
  const format = resolvedFormat(options, context);
  if (!isLossless(format)) return (options.kbps * 1000) / 8;
  const rate = options.sampleRate || context.info?.sampleRate || 44_100;
  const pcm = rate * channelCount(options, context) * 2;
  // FLAC typically lands a little over half of the raw samples.
  return format === 'flac' ? pcm * 0.6 : pcm;
}

export const audioResample = defineOperation<AudioResampleOptions>({
  id: 'audio-resample',
  route: 'audio-quality',
  title: 'Change bitrate or sample rate',
  verb: 'Re-encode',
  summary: 'Pick the exact bitrate, sample rate and channels a sound file is saved with.',
  group: 'audio',
  accepts: ['audio'],
  defaults: DEFAULT_RESAMPLE,
  outputSuffix: 'reencoded',

  rejects: (context) =>
    context.info?.hasAudio === false ? 'This file has no sound in it.' : undefined,

  fields: [
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      choices: (_options, context) => [
        { value: 'same', label: `Keep ${FORMAT_LABELS[soundFormat(context)]}` },
        { value: 'mp3', label: 'MP3', note: 'plays everywhere' },
        { value: 'm4a', label: 'M4A', note: 'AAC, good at small sizes' },
        { value: 'opus', label: 'Opus', note: 'best quality per byte' },
        { value: 'wav', label: 'WAV', note: 'uncompressed, large' },
        { value: 'flac', label: 'FLAC', note: 'lossless, compressed' },
        { value: 'ogg', label: 'OGG', note: 'Vorbis' },
      ],
    },
    {
      kind: 'chips',
      key: 'kbps',
      label: 'Bitrate',
      visibleWhen: (options, context) => !isLossless(resolvedFormat(options, context)),
      choices: [
        { value: 64, label: '64 kbps', note: 'voice' },
        { value: 96, label: '96 kbps' },
        { value: 128, label: '128 kbps' },
        { value: 192, label: '192 kbps' },
        { value: 256, label: '256 kbps' },
        { value: 320, label: '320 kbps', note: 'highest' },
      ],
    },
    {
      kind: 'chips',
      key: 'sampleRate',
      label: 'Sample rate',
      visibleWhen: (options, context) => resolvedFormat(options, context) !== 'opus',
      choices: [
        { value: 0, label: 'Keep' },
        { value: 22_050, label: '22.05 kHz', note: 'voice' },
        { value: 44_100, label: '44.1 kHz', note: 'CD, music' },
        { value: 48_000, label: '48 kHz', note: 'video' },
      ],
    },
    {
      kind: 'segmented',
      key: 'channels',
      label: 'Channels',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: 'mono', label: 'Mono' },
        { value: 'stereo', label: 'Stereo' },
      ],
    },
  ],

  preflight: (options, context) => {
    const warnings: string[] = [];
    const source = context.info?.sampleRate;

    if (source !== undefined && options.sampleRate > source) {
      warnings.push(
        'Raising the sample rate makes the file bigger without adding anything that was not recorded.',
      );
    }
    if (
      resolvedFormat(options, context) === 'mp3' &&
      options.sampleRate > 0 &&
      options.sampleRate < 32_000 &&
      options.kbps > 160
    ) {
      // Measured on the core: LAME caps it without a word.
      warnings.push('Below 32 kHz, MP3 tops out at 160 kbps, so that is what you will get.');
    }
    if (options.channels === 'stereo' && context.info?.channels === 1) {
      warnings.push('This recording is mono, so stereo would be the same sound twice.');
    }
    return warnings;
  },

  build: (options, paths, context) => buildAudioResampleArgs(options, paths, context),
  outputExtension: (options, context) => resolvedFormat(options, context),
  outputMime: (options, context) => AUDIO_MIME[resolvedFormat(options, context)],

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    if (duration === undefined) return undefined;
    return Math.round(duration * bytesPerSecond(options, context));
  },
});
