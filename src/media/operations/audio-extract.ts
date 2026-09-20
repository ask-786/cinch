import { defineOperation } from './descriptor';

/**
 * Pull the sound out of a video, or re-encode an audio file. One descriptor
 * serves both — the only difference is which file it is pointed at.
 */

export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac' | 'ogg';
export type AudioBitrate = 'copy' | 'small' | 'good' | 'high';

export type AudioExtractOptions = {
  readonly format: AudioFormat;
  readonly bitrate: AudioBitrate;
};

export const DEFAULT_AUDIO_EXTRACT: AudioExtractOptions = {
  format: 'mp3',
  bitrate: 'good',
};

const ENCODERS: Readonly<Record<AudioFormat, string>> = {
  mp3: 'libmp3lame',
  m4a: 'aac',
  opus: 'libopus',
  wav: 'pcm_s16le',
  flac: 'flac',
  ogg: 'libvorbis',
};

const MIME: Readonly<Record<AudioFormat, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
};

/** WAV and FLAC carry every sample, so a bitrate would mean nothing. */
const LOSSLESS: readonly AudioFormat[] = ['wav', 'flac'];

const BITRATE_KBPS: Readonly<Record<Exclude<AudioBitrate, 'copy'>, number>> = {
  small: 96,
  good: 192,
  high: 320,
};

/** Which source codec each container can hold without re-encoding. */
const COPYABLE: Readonly<Record<AudioFormat, readonly string[]>> = {
  mp3: ['mp3'],
  m4a: ['aac', 'alac'],
  opus: ['opus'],
  ogg: ['vorbis'],
  wav: [],
  flac: ['flac'],
};

export function canCopyTrack(format: AudioFormat, sourceCodec: string | undefined): boolean {
  if (!sourceCodec) return false;
  return COPYABLE[format].includes(sourceCodec);
}

export function isLossless(format: AudioFormat): boolean {
  return LOSSLESS.includes(format);
}

export function buildAudioExtractArgs(
  options: AudioExtractOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath, '-vn'];

  if (options.bitrate === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:a', ENCODERS[options.format]);
    if (!isLossless(options.format)) {
      args.push('-b:a', `${BITRATE_KBPS[options.bitrate]}k`);
    }
  }

  args.push(paths.outputPath);
  return args;
}

/** Bytes per second of audio, for the estimate under the form. */
export function audioBytesPerSecond(options: AudioExtractOptions): number | undefined {
  if (options.bitrate === 'copy') return undefined;
  if (options.format === 'wav') return 44_100 * 2 * 2; // 16-bit stereo at CD rate
  if (options.format === 'flac') return Math.round(44_100 * 2 * 2 * 0.6);
  return (BITRATE_KBPS[options.bitrate] * 1000) / 8;
}

export const audioExtract = defineOperation<AudioExtractOptions>({
  id: 'audio-extract',
  route: 'audio',
  title: 'Extract audio',
  verb: 'Extract audio',
  summary: 'Save just the sound, as MP3, M4A, Opus, WAV or FLAC.',
  group: 'audio',
  accepts: ['video', 'audio'],
  defaults: DEFAULT_AUDIO_EXTRACT,
  outputSuffix: 'audio',

  rejects: (context) =>
    context.info?.hasAudio === false ? 'This file has no sound in it.' : undefined,

  fields: [
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
        { value: 'ogg', label: 'OGG', note: 'Vorbis' },
      ],
    },
    {
      kind: 'select',
      key: 'bitrate',
      label: 'Quality',
      visibleWhen: (options) => !isLossless(options.format),
      choices: (options, context) => {
        const copyable = canCopyTrack(options.format, context.info?.audioCodec);
        return [
          {
            value: 'copy',
            label: 'Leave the sound alone',
            note: copyable ? 'instant, no quality lost' : 'needs a matching format',
            disabled: !copyable,
          },
          { value: 'small', label: 'Smaller', note: '96 kbps' },
          { value: 'good', label: 'Good', note: '192 kbps' },
          { value: 'high', label: 'High', note: '320 kbps' },
        ];
      },
    },
  ],

  normalize: (options, context) => {
    if (isLossless(options.format) && options.bitrate === 'copy') {
      return { ...options, bitrate: 'good' };
    }
    if (options.bitrate === 'copy' && !canCopyTrack(options.format, context.info?.audioCodec)) {
      return { ...options, bitrate: 'good' };
    }
    return options;
  },

  preflight: (options, context) => {
    const warnings: string[] = [];
    const source = context.info?.audioCodec;

    if (options.format === 'wav' && (context.info?.durationSeconds ?? 0) > 600) {
      warnings.push(
        'WAV keeps every sample, so an hour of audio is around 600 MB. FLAC sounds identical and is about half the size.',
      );
    }
    if (source && !isLossless(options.format) && options.bitrate !== 'copy') {
      warnings.push(
        `The sound is already ${source.toUpperCase()}. Re-encoding it loses a little quality — "leave the sound alone" avoids that when the formats match.`,
      );
    }
    return warnings;
  },

  build: (options, paths) => buildAudioExtractArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => MIME[options.format],

  estimateBytes: (options, context) => {
    const duration = context.info?.durationSeconds;
    const perSecond = audioBytesPerSecond(options);
    if (duration === undefined || perSecond === undefined) return undefined;
    return Math.round(duration * perSecond);
  },
});
