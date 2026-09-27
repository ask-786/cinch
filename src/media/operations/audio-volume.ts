import { defineOperation } from './descriptor';
import {
  buildSoundArgs,
  rejectSilent,
  soundEstimate,
  soundExtension,
  soundMime,
} from './sound-output';

/**
 * Make the sound louder or quieter by a fixed amount.
 *
 * Turning it up pushes the loudest moments past full scale, where they clip
 * and crackle. So a boost always runs through a limiter that holds the peaks
 * just under 0 dB — measured on the core, +20 dB on music clipped 26,000
 * samples without it and none with it, and the length did not change.
 */

export type AudioVolumeOptions = {
  /** Decibels: +10 sounds about twice as loud, −10 about half. */
  readonly gainDb: number | undefined;
};

export const DEFAULT_VOLUME: AudioVolumeOptions = {
  gainDb: 6,
};

const MIN_GAIN = -30;
const MAX_GAIN = 30;
/** −1 dBFS, as a linear amplitude — headroom for the encoder's own overshoot. */
const LIMIT = 0.891;

export function clampGain(gain: number | undefined): number {
  if (gain === undefined || Number.isNaN(gain)) return 0;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, gain));
}

export function volumeFilter(options: AudioVolumeOptions): string {
  const gain = clampGain(options.gainDb);
  const filter = `volume=${gain}dB`;
  // level=disabled stops the limiter from turning the result back down to
  // where it started, which is its default.
  return gain > 0 ? `${filter},alimiter=limit=${LIMIT}:level=disabled` : filter;
}

function signed(gain: number): string {
  return gain > 0 ? `+${gain}` : String(gain).replace('-', '−');
}

export const audioVolume = defineOperation<AudioVolumeOptions>({
  id: 'audio-volume',
  route: 'volume',
  title: 'Change volume',
  verb: 'Change volume',
  summary: 'Make the sound louder or quieter, without the loud parts crackling.',
  group: 'audio',
  accepts: ['audio', 'video'],
  defaults: DEFAULT_VOLUME,
  outputSuffix: 'volume',

  rejects: rejectSilent,

  fields: [
    {
      kind: 'chips',
      key: 'gainDb',
      label: 'Change',
      choices: [
        { value: -10, label: '−10 dB', note: 'half as loud' },
        { value: -6, label: '−6 dB', note: 'quieter' },
        { value: 3, label: '+3 dB', note: 'a little louder' },
        { value: 6, label: '+6 dB', note: 'louder' },
        { value: 10, label: '+10 dB', note: 'twice as loud' },
      ],
    },
    {
      kind: 'number',
      key: 'gainDb',
      label: 'Or type an amount',
      suffix: 'dB',
      min: MIN_GAIN,
      max: MAX_GAIN,
      step: 1,
      placeholder: '6',
      hint: 'Above 0 is louder, below 0 is quieter.',
    },
  ],

  normalize: (options) => {
    // An empty box is a half-typed number, not a reason to rewrite the value.
    if (options.gainDb === undefined) return options;
    const clamped = clampGain(options.gainDb);
    return clamped === options.gainDb ? options : { ...options, gainDb: clamped };
  },

  preflight: (options) => {
    const warnings: string[] = [];
    const gain = clampGain(options.gainDb);
    if (gain === 0) warnings.push('At 0 dB nothing changes.');
    if (gain >= 12) {
      warnings.push(
        `At ${signed(gain)} dB the loudest parts are held back to stop them crackling, which can make the sound feel squashed. "Normalise loudness" is gentler if the aim is just "loud enough".`,
      );
    }
    return warnings;
  },

  build: (options, paths, context) => buildSoundArgs(volumeFilter(options), paths, context),
  outputExtension: (_options, context) => soundExtension(context),
  outputMime: (_options, context) => soundMime(context),
  estimateBytes: (_options, context) => soundEstimate(context),
});
