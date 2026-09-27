import { defineOperation, type OperationContext } from './descriptor';
import {
  buildSoundArgs,
  rejectSilent,
  soundEstimate,
  soundExtension,
  soundMime,
  writesOpus,
} from './sound-output';

/**
 * Bring a recording to a standard loudness, the way streaming services and
 * podcast apps expect it — louder or quieter as needed, without clipping.
 *
 * `loudnorm` in one pass adjusts as it goes; measured on the core, a −28 LUFS
 * clip asked for −16 came out at −15.9. It works internally at 192 kHz and
 * leaves the output there unless told otherwise, so the source's own rate is
 * put back.
 */

export type LoudnessTarget = -14 | -16 | -23;

export type AudioLoudnessOptions = {
  readonly target: LoudnessTarget;
};

export const DEFAULT_LOUDNESS: AudioLoudnessOptions = {
  target: -16,
};

/** When the sample rate has not been read yet: what video almost always uses. */
const FALLBACK_RATE = 48_000;

export function loudnessRate(context: OperationContext): number {
  if (writesOpus(context)) return 48_000;
  return context.info?.sampleRate ?? FALLBACK_RATE;
}

/** Streaming platforms want a little more headroom than broadcast asks for. */
const TRUE_PEAK: Readonly<Record<LoudnessTarget, number>> = {
  [-14]: -1,
  [-16]: -1.5,
  [-23]: -1,
};

export function loudnessFilter(options: AudioLoudnessOptions): string {
  return `loudnorm=I=${options.target}:TP=${TRUE_PEAK[options.target]}:LRA=11`;
}

export const audioLoudness = defineOperation<AudioLoudnessOptions>({
  id: 'audio-loudness',
  route: 'loudness',
  title: 'Normalise loudness',
  verb: 'Normalise',
  summary: 'Even out how loud a recording is, to the level podcasts and streaming use.',
  group: 'audio',
  accepts: ['audio', 'video'],
  defaults: DEFAULT_LOUDNESS,
  outputSuffix: 'normalised',

  rejects: rejectSilent,

  fields: [
    {
      kind: 'chips',
      key: 'target',
      label: 'Aim for',
      hint: 'Measured in LUFS — how loud it sounds on average, not how loud its peaks are.',
      choices: [
        { value: -14, label: '−14 LUFS', note: 'Spotify, YouTube' },
        { value: -16, label: '−16 LUFS', note: 'podcasts, Apple' },
        { value: -23, label: '−23 LUFS', note: 'broadcast (EBU R128)' },
      ],
    },
  ],

  build: (options, paths, context) =>
    buildSoundArgs(loudnessFilter(options), paths, context, ['-ar', String(loudnessRate(context))]),
  outputExtension: (_options, context) => soundExtension(context),
  outputMime: (_options, context) => soundMime(context),
  estimateBytes: (_options, context) => soundEstimate(context),
});
