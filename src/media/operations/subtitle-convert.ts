import { defineOperation, type OperationContext } from './descriptor';
import {
  ENCODING_CHOICES,
  ENCODING_HINT,
  FORMAT_CHOICES,
  isStyled,
  subtitleCodec,
  subtitleMime,
  type SubtitleFormat,
} from './subtitle-format';

/**
 * Turn one subtitle file into another format, and fix the two things that go
 * wrong with downloaded subtitles: they are early or late, or they are in an
 * old code page and come out as gibberish.
 */

export type SubtitleConvertOptions = {
  /** Empty until the file is known: SRT becomes WebVTT, everything else SRT. */
  readonly format?: SubtitleFormat;
  /** An iconv name, or empty for UTF-8. */
  readonly encoding?: string;
  /** Seconds to move every line by; negative is earlier. */
  readonly shift?: number;
};

export const DEFAULT_SUBTITLE_CONVERT: SubtitleConvertOptions = {
  format: undefined,
  encoding: undefined,
  shift: undefined,
};

export function targetFormat(
  options: SubtitleConvertOptions,
  context: OperationContext,
): SubtitleFormat {
  return options.format ?? (context.media?.extension === 'srt' ? 'vtt' : 'srt');
}

export function buildSubtitleConvertArgs(
  options: SubtitleConvertOptions,
  format: SubtitleFormat,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args: string[] = [];
  if (options.encoding) args.push('-sub_charenc', options.encoding);
  // A plain `-itsoffset` below zero is undone: FFmpeg moves the first line
  // back to 0:00, so -1 s and -2.5 s came out the same. `-copyts` keeps the
  // shifted times and `-ss 0` drops the lines that now start before zero —
  // measured on the core, which otherwise writes them as `00:00:00,-500`.
  if (options.shift) args.push('-copyts', '-itsoffset', String(options.shift));
  args.push('-i', paths.inputPath);
  if (options.shift) args.push('-ss', '0');
  args.push('-c:s', subtitleCodec(format), paths.outputPath);
  return args;
}

export const subtitleConvert = defineOperation<SubtitleConvertOptions>({
  id: 'subtitle-convert',
  route: 'convert-subtitles',
  title: 'Convert subtitles',
  verb: 'Convert',
  summary: 'Change a subtitle file to SRT, WebVTT or ASS, fix its timing or its text encoding.',
  group: 'subtitle',
  accepts: ['subtitle'],
  defaults: DEFAULT_SUBTITLE_CONVERT,
  outputSuffix: 'converted',

  fields: [
    { kind: 'segmented', key: 'format', label: 'Save as', choices: FORMAT_CHOICES },
    {
      kind: 'number',
      key: 'shift',
      label: 'Move every line by',
      suffix: 's',
      step: 0.1,
      placeholder: '0',
      hint: 'Above 0 shows them later, below 0 earlier. A line that would start before 0:00 is left out.',
    },
    {
      kind: 'select',
      key: 'encoding',
      label: 'Text encoding',
      choices: ENCODING_CHOICES,
      hint: ENCODING_HINT,
    },
  ],

  // Opened with no file yet, there is nothing to decide by: choosing now
  // would turn an SRT into an SRT once it arrives.
  normalize: (options, context) =>
    options.format || !context.media
      ? options
      : { ...options, format: targetFormat(options, context) },

  preflight: (options, context) => {
    const extension = context.media?.extension;
    return isStyled(extension) && targetFormat(options, context) !== 'ass'
      ? ['This file has its own fonts and positions. Only ASS keeps them.']
      : [];
  },

  build: (options, paths, context) =>
    buildSubtitleConvertArgs(options, targetFormat(options, context), paths),
  outputExtension: (options, context) => targetFormat(options, context),
  outputMime: (options, context) => subtitleMime(targetFormat(options, context)),
});
