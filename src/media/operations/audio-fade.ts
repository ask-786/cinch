import { defineOperation } from './descriptor';
import {
  buildSoundArgs,
  rejectSilent,
  soundEstimate,
  soundExtension,
  soundMime,
} from './sound-output';

/**
 * Bring the sound up from silence at the start, down to silence at the end,
 * or both.
 *
 * `afade` has no idea where a file ends, so the fade out is placed from the
 * probed length: it starts that many seconds before the end.
 */

export type AudioFadeOptions = {
  /** Seconds; 0 leaves the start alone. */
  readonly fadeIn: number | undefined;
  readonly fadeOut: number | undefined;
};

export const DEFAULT_FADE: AudioFadeOptions = {
  fadeIn: 2,
  fadeOut: 3,
};

const MAX_FADE = 60;

function seconds(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value) || value < 0) return 0;
  return Math.min(MAX_FADE, value);
}

/** Trailing zeroes read badly in a command the user can copy. */
function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function fadeFilter(options: AudioFadeOptions, durationSeconds: number | undefined): string {
  const filters: string[] = [];
  const fadeIn = seconds(options.fadeIn);
  const fadeOut = seconds(options.fadeOut);

  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${trim(fadeIn)}`);
  // Without a length there is nowhere to put the fade out.
  if (fadeOut > 0 && durationSeconds !== undefined) {
    const start = Math.max(0, durationSeconds - fadeOut);
    filters.push(`afade=t=out:st=${trim(start)}:d=${trim(fadeOut)}`);
  }
  // A filter that does nothing keeps the command valid when both are off.
  return filters.length > 0 ? filters.join(',') : 'anull';
}

const LENGTHS = [
  { value: 0, label: 'None' },
  { value: 1, label: '1 s' },
  { value: 2, label: '2 s' },
  { value: 3, label: '3 s' },
  { value: 5, label: '5 s' },
  { value: 10, label: '10 s' },
];

export const audioFade = defineOperation<AudioFadeOptions>({
  id: 'audio-fade',
  route: 'fade',
  title: 'Fade in and out',
  verb: 'Add fades',
  summary: 'Let the sound rise from silence at the start and fall away at the end.',
  group: 'audio',
  accepts: ['audio', 'video'],
  defaults: DEFAULT_FADE,
  outputSuffix: 'faded',

  rejects: rejectSilent,

  fields: [
    { kind: 'chips', key: 'fadeIn', label: 'Fade in', choices: LENGTHS },
    { kind: 'chips', key: 'fadeOut', label: 'Fade out', choices: LENGTHS },
  ],

  preflight: (options, context) => {
    const warnings: string[] = [];
    const fadeIn = seconds(options.fadeIn);
    const fadeOut = seconds(options.fadeOut);
    const duration = context.info?.durationSeconds;

    if (fadeIn === 0 && fadeOut === 0) warnings.push('With no fade either way, nothing changes.');
    if (fadeOut > 0 && duration === undefined) {
      warnings.push(
        'The length of this file is still being read, so the fade out cannot be placed yet.',
      );
    }
    if (duration !== undefined && fadeIn + fadeOut > duration) {
      warnings.push('The fades are longer than the file, so they will overlap.');
    }
    return warnings;
  },

  build: (options, paths, context) =>
    buildSoundArgs(fadeFilter(options, context.info?.durationSeconds), paths, context),
  outputExtension: (_options, context) => soundExtension(context),
  outputMime: (_options, context) => soundMime(context),
  estimateBytes: (_options, context) => soundEstimate(context),
});
