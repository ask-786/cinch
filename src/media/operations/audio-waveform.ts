import { defineOperation } from './descriptor';
import { rejectSilent } from './sound-output';

/**
 * A picture of a recording's shape — for a podcast's artwork, a video
 * thumbnail, or just seeing where the quiet parts are.
 *
 * Drawn on a linear scale, ordinary speech and music barely lift off the
 * centre line, so the height follows the square root of the level instead.
 * The background is transparent unless one is chosen, which suits a picture
 * that will be laid over something else.
 *
 * A spectrogram was measured and left out: the core's `showspectrumpic` took
 * 71 s for one minute of audio at 300×100, and 98 s for nine seconds at
 * 1200×400, where the desktop build takes under a second for either.
 */

export type WaveformColour = 'blue' | 'black' | 'white' | 'orange';
export type WaveformBackground = 'none' | 'white' | 'black';

export type AudioWaveformOptions = {
  readonly width: number;
  readonly height: number;
  readonly colour: WaveformColour;
  readonly background: WaveformBackground;
  /** One band per channel rather than all of them folded together. */
  readonly splitChannels: boolean;
};

export const DEFAULT_WAVEFORM: AudioWaveformOptions = {
  width: 1920,
  height: 400,
  colour: 'blue',
  background: 'none',
  splitChannels: false,
};

const COLOURS: Readonly<Record<WaveformColour, string>> = {
  blue: '0x2563eb',
  black: '0x111111',
  white: '0xffffff',
  orange: '0xf97316',
};

const BACKGROUNDS: Readonly<Record<Exclude<WaveformBackground, 'none'>, string>> = {
  white: '0xffffff',
  black: '0x000000',
};

export function waveformFilter(options: AudioWaveformOptions): string {
  const size = `${options.width}x${options.height}`;
  // Folding to mono first draws one shape; split_channels draws a band each.
  const fold = options.splitChannels ? '' : 'aformat=channel_layouts=mono,';
  const wave =
    `[0:a:0]${fold}showwavespic=s=${size}:colors=${COLOURS[options.colour]}:scale=sqrt` +
    (options.splitChannels ? ':split_channels=1' : '');

  if (options.background === 'none') return wave;
  return (
    `${wave}[w];color=c=${BACKGROUNDS[options.background]}:s=${size}[bg];` +
    `[bg][w]overlay=format=auto`
  );
}

export function buildAudioWaveformArgs(
  options: AudioWaveformOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-filter_complex',
    waveformFilter(options),
    '-frames:v',
    '1',
    paths.outputPath,
  ];
}

export const audioWaveform = defineOperation<AudioWaveformOptions>({
  id: 'audio-waveform',
  route: 'waveform',
  title: 'Waveform image',
  verb: 'Draw waveform',
  summary: 'A picture of the sound’s shape, as a PNG.',
  group: 'audio',
  accepts: ['audio', 'video'],
  defaults: DEFAULT_WAVEFORM,
  outputSuffix: 'waveform',

  rejects: rejectSilent,

  fields: [
    {
      kind: 'chips',
      key: 'width',
      label: 'Width',
      choices: [
        { value: 1200, label: '1200 px' },
        { value: 1920, label: '1920 px' },
        { value: 3840, label: '3840 px' },
      ],
    },
    {
      kind: 'chips',
      key: 'height',
      label: 'Height',
      choices: [
        { value: 200, label: '200 px' },
        { value: 400, label: '400 px' },
        { value: 800, label: '800 px' },
      ],
    },
    {
      kind: 'segmented',
      key: 'colour',
      label: 'Colour',
      choices: [
        { value: 'blue', label: 'Blue' },
        { value: 'orange', label: 'Orange' },
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
      ],
      warnWhen: (options) =>
        options.colour === options.background
          ? 'The waveform is the same colour as the background, so it will not show.'
          : undefined,
    },
    {
      kind: 'segmented',
      key: 'background',
      label: 'Background',
      choices: [
        { value: 'none', label: 'Transparent' },
        { value: 'white', label: 'White' },
        { value: 'black', label: 'Black' },
      ],
    },
    {
      kind: 'toggle',
      key: 'splitChannels',
      label: 'Draw each channel separately',
      hint: 'Left above right, for a stereo recording.',
      visibleWhen: (_options, context) => context.info?.channels !== 1,
    },
  ],

  build: (options, paths) => buildAudioWaveformArgs(options, paths),
  outputExtension: () => 'png',
  outputMime: () => 'image/png',

  estimateBytes: (options) =>
    // A flat-coloured shape compresses well; measured at a few KB for 1200×300.
    Math.round(options.width * options.height * 0.02),
});
