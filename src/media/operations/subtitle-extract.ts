import { defineOperation } from './descriptor';
import {
  firstTextTrack,
  FORMAT_CHOICES,
  isStyled,
  subtitleCodec,
  subtitleMime,
  trackChoices,
  trackProblem,
  type SubtitleFormat,
} from './subtitle-format';

/**
 * Save a video's own subtitle track as a file of its own — an MKV's English
 * track as an SRT to edit, or to load beside the video in another player.
 */

export type SubtitleExtractOptions = {
  /** Which subtitle track, counted among subtitle tracks only. */
  readonly track: number;
  readonly format: SubtitleFormat;
};

export const DEFAULT_SUBTITLE_EXTRACT: SubtitleExtractOptions = { track: 0, format: 'srt' };

export function buildSubtitleExtractArgs(
  options: SubtitleExtractOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-map',
    `0:s:${options.track}`,
    '-c:s',
    subtitleCodec(options.format),
    paths.outputPath,
  ];
}

export const subtitleExtract = defineOperation<SubtitleExtractOptions>({
  id: 'subtitle-extract',
  route: 'extract-subtitles',
  title: 'Extract subtitles',
  verb: 'Extract',
  summary: "Save a video's subtitle track as an SRT, WebVTT or ASS file.",
  group: 'subtitle',
  accepts: ['video'],
  defaults: DEFAULT_SUBTITLE_EXTRACT,
  outputSuffix: 'subtitles',

  rejects: (context) => trackProblem(context.info),

  fields: [
    {
      kind: 'select',
      key: 'track',
      label: 'Track',
      choices: (_options, context) => trackChoices(context.info),
    },
    { kind: 'segmented', key: 'format', label: 'Save as', choices: FORMAT_CHOICES },
  ],

  normalize: (options, context) => {
    const track = context.info?.subtitles?.[options.track];
    if (track && !track.text) return { ...options, track: firstTextTrack(context.info) ?? 0 };
    return options;
  },

  preflight: (options, context) => {
    const track = context.info?.subtitles?.[options.track];
    return isStyled(track?.codec) && options.format !== 'ass'
      ? ['This track has its own fonts and positions. Only ASS keeps them.']
      : [];
  },

  build: (options, paths) => buildSubtitleExtractArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => subtitleMime(options.format),
});
