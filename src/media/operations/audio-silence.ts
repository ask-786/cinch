import type { MediaInfo } from '../models/media-info';
import { defineOperation } from './descriptor';
import {
  buildSoundArgs,
  rejectSilent,
  soundEstimate,
  soundExtension,
  soundMime,
} from './sound-output';

/**
 * Cut the dead air out of a recording: the quiet before it starts and after
 * it ends, or every long pause in between too.
 *
 * `silenceremove` only looks forwards, so the silence at the end is reached by
 * reversing the sound, trimming its new start, and reversing it back. Reversing
 * holds the whole recording in memory as float samples, the same cost reverse
 * pays for video, so a long file is steered to "every pause" instead — which
 * catches the end in one forward pass by treating it as a pause that never
 * finishes. Audio only: taking pauses out of a video's sound would leave it
 * out of step with the picture.
 */

export type SilenceWhere = 'ends' | 'all';

export type AudioSilenceOptions = {
  readonly where: SilenceWhere;
  /** How quiet counts as silence, in dBFS. */
  readonly threshold: number;
  /** For "every pause": how long a pause must be before it is cut. */
  readonly pause: number;
};

export const DEFAULT_SILENCE: AudioSilenceOptions = {
  where: 'ends',
  threshold: -50,
  pause: 1,
};

/** Past this, reversing the sound would not fit comfortably in the tab. */
export const SILENCE_REVERSE_LIMIT_BYTES = 500_000_000;

/** A beat of each cut pause is kept, so sentences do not run into each other. */
const KEEP_OF_PAUSE = 0.25;

/** `areverse` holds 32-bit float samples, one per channel. */
export function reverseBytes(info: MediaInfo | undefined): number | undefined {
  if (info?.durationSeconds === undefined) return undefined;
  const rate = info.sampleRate ?? 48_000;
  const channels = info.channels ?? 2;
  return Math.round(info.durationSeconds * rate * channels * 4);
}

function endsFit(info: MediaInfo | undefined): boolean {
  const bytes = reverseBytes(info);
  return bytes === undefined || bytes <= SILENCE_REVERSE_LIMIT_BYTES;
}

export function silenceFilter(options: AudioSilenceOptions): string {
  const level = `${options.threshold}dB`;
  const start = `silenceremove=start_periods=1:start_threshold=${level}`;

  if (options.where === 'ends') return `${start},areverse,${start},areverse`;

  // stop_periods=-1 removes every pause at least stop_duration long; the one
  // at the end is just a pause with nothing after it.
  return (
    `${start}:stop_periods=-1:stop_duration=${options.pause}` +
    `:stop_threshold=${level}:stop_silence=${KEEP_OF_PAUSE}`
  );
}

export const audioSilence = defineOperation<AudioSilenceOptions>({
  id: 'audio-silence',
  route: 'trim-silence',
  title: 'Trim silence',
  verb: 'Trim silence',
  summary: 'Cut the quiet from the start and end of a recording, or every long pause.',
  group: 'audio',
  accepts: ['audio'],
  defaults: DEFAULT_SILENCE,
  outputSuffix: 'trimmed',

  rejects: rejectSilent,

  fields: [
    {
      kind: 'segmented',
      key: 'where',
      label: 'Cut',
      choices: (_options, context) => {
        const fits = endsFit(context.info);
        return [
          {
            value: 'ends',
            label: 'Start and end',
            note: fits ? undefined : 'too long for this',
            disabled: !fits,
          },
          { value: 'all', label: 'Every long pause' },
        ];
      },
    },
    {
      kind: 'chips',
      key: 'pause',
      label: 'Pauses longer than',
      visibleWhen: (options) => options.where === 'all',
      hint: 'A quarter of a second of each pause is kept, so words do not run together.',
      choices: [
        { value: 0.5, label: '½ s' },
        { value: 1, label: '1 s' },
        { value: 2, label: '2 s' },
        { value: 5, label: '5 s' },
      ],
    },
    {
      kind: 'segmented',
      key: 'threshold',
      label: 'Counts as silence',
      hint: 'In a noisy room, hiss and hum never get quiet enough to count as silence at the stricter settings.',
      choices: [
        { value: -60, label: 'Near silent', note: 'studio' },
        { value: -50, label: 'Quiet', note: 'most recordings' },
        { value: -40, label: 'Background noise', note: 'noisy room' },
      ],
    },
  ],

  normalize: (options, context) =>
    options.where === 'ends' && !endsFit(context.info) ? { ...options, where: 'all' } : options,

  build: (options, paths, context) => buildSoundArgs(silenceFilter(options), paths, context),
  outputExtension: (_options, context) => soundExtension(context),
  outputMime: (_options, context) => soundMime(context),
  // How much goes is the whole question, so the source's length is an upper bound.
  estimateBytes: (_options, context) => soundEstimate(context),
});
