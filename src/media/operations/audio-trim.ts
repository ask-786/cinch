import { defineOperation, timestamp } from './descriptor';
import { rejectSilent } from './sound-output';
import { clampTrim } from './video-trim';

/**
 * Cut a stretch out of a sound file. It shares trim's form — two handles over
 * a player — but not its trade-off: a video copy can only cut on a keyframe,
 * seconds apart, while sound is packed in frames of a few hundredths of a
 * second. So the sound is always copied, never re-encoded, and lands where
 * asked to within one of those frames. It keeps the file's own format, so
 * nothing is lost.
 */

export type AudioTrimOptions = {
  readonly startSeconds: number;
  readonly endSeconds: number;
};

export const DEFAULT_AUDIO_TRIM: AudioTrimOptions = {
  startSeconds: 0,
  endSeconds: 0,
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
};

function extensionOf(extension: string | undefined): string {
  return extension || 'mp3';
}

export function audioTrimSeconds(options: AudioTrimOptions): number {
  return Math.max(0, options.endSeconds - options.startSeconds);
}

export function buildAudioTrimArgs(
  options: AudioTrimOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-ss', timestamp(options.startSeconds), '-i', paths.inputPath];
  const duration = audioTrimSeconds(options);
  if (duration > 0) args.push('-t', timestamp(duration));
  // -vn leaves cover art behind: not every container copies it cleanly.
  args.push('-vn', '-c:a', 'copy', paths.outputPath);
  return args;
}

export const audioTrim = defineOperation<AudioTrimOptions>({
  id: 'audio-trim',
  route: 'trim-audio',
  title: 'Trim audio',
  verb: 'Trim',
  summary: 'Keep the part of a recording you want, without re-encoding it.',
  group: 'audio',
  accepts: ['audio'],
  defaults: DEFAULT_AUDIO_TRIM,
  outputSuffix: 'clip',
  customForm: 'trim',

  // No generated fields: the custom form owns the whole thing.
  fields: [],

  rejects: rejectSilent,

  normalize: (options, context) => clampTrim(options, context.info?.durationSeconds),

  preflight: (options, context) => {
    const warnings: string[] = [];
    if (audioTrimSeconds(options) <= 0) {
      warnings.push('The end of the clip is not after its start, so there is nothing to keep.');
    }
    if (context.info?.durationSeconds === undefined) {
      warnings.push('The length of this file is still being read.');
    }
    return warnings;
  },

  build: (options, paths) => buildAudioTrimArgs(options, paths),
  outputExtension: (_options, context) => extensionOf(context.media?.extension),
  outputMime: (_options, context) =>
    MIME_BY_EXTENSION[extensionOf(context.media?.extension)] ?? 'application/octet-stream',

  outputDuration: (options) => audioTrimSeconds(options),

  estimateBytes: (options, context) => {
    const source = context.media?.size;
    const total = context.info?.durationSeconds;
    if (source === undefined || !total) return undefined;
    return Math.round(source * Math.min(1, audioTrimSeconds(options) / total));
  },
});
