import { FONTS_DIR } from '../ffmpeg/font-assets';
import type { MediaKind } from '../models/media-kind';
import { defineOperation, type OperationContext, type OperationInput } from './descriptor';
import { escapeFilterValue } from './filter-escape';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import {
  CJK_ENCODINGS,
  ENCODING_CHOICES,
  ENCODING_HINT,
  firstTextTrack,
  isStyled,
  trackChoices,
  trackProblem,
} from './subtitle-format';
import { qualityToCrf } from './video-compress';

/**
 * Draw subtitles into the picture, for players and sites that cannot show a
 * separate track. They come from a subtitle file given alongside the video,
 * or, without one, from the video's own track.
 *
 * The core's libass has no font provider, so it cannot fall back from the
 * font a file asks for (Arial, usually) to one it has: every style is forced
 * to DejaVu Sans, loaded from `fontsdir`. ASS keeps the rest of its styling;
 * SRT and WebVTT are restyled from the options here.
 */

export type SubtitlePosition = 'bottom' | 'top';
export type SubtitleStyle = 'outline' | 'box';

export type SubtitleBurnOptions = {
  /** The video's own track, used when no subtitle file is given. */
  readonly track: number;
  /** The letters' height as a share of the frame's, in percent. */
  readonly size: number;
  readonly position: SubtitlePosition;
  readonly style: SubtitleStyle;
  readonly bold: boolean;
  /** An iconv name for the subtitle file, or empty for UTF-8. */
  readonly encoding?: string;
  readonly quality: number;
};

export const DEFAULT_SUBTITLE_BURN: SubtitleBurnOptions = {
  track: 0,
  size: 6,
  position: 'bottom',
  style: 'outline',
  bold: false,
  encoding: undefined,
  quality: 60,
};

/**
 * The height libass lays SRT and WebVTT out against. Sizes and margins in
 * `force_style` are in these units and scaled to the real frame.
 */
const PLAY_RES_Y = 288;

/**
 * `force_style` takes the legacy SSA alignment on this core, not the numpad
 * one: 8 came out middle-left. 2 is bottom centre and 6 top centre.
 */
const ALIGNMENT: Readonly<Record<SubtitlePosition, number>> = { bottom: 2, top: 6 };

const FONT_NAME = 'DejaVu Sans';

export function subtitleRoles(kinds: readonly (MediaKind | undefined)[]): {
  video: number;
  subtitles?: number;
} {
  const video = Math.max(0, kinds.indexOf('video'));
  const subtitles = kinds.indexOf('subtitle');
  return subtitles === -1 ? { video } : { video, subtitles };
}

/** The `force_style` list: the font always, the look only for unstyled subtitles. */
export function subtitleStyle(options: SubtitleBurnOptions, styled: boolean): string {
  const style = [`FontName=${FONT_NAME}`];
  if (styled) return style.join(',');

  style.push(
    `FontSize=${Math.round((PLAY_RES_Y * options.size) / 100)}`,
    `Bold=${options.bold ? 1 : 0}`,
    `Alignment=${ALIGNMENT[options.position]}`,
    `MarginV=${Math.round(PLAY_RES_Y * 0.05)}`,
    'Shadow=0',
  );
  if (options.style === 'box') {
    // libass fills the box with the outline colour; &H60 lets some picture through.
    style.push('BorderStyle=3', 'Outline=2', 'OutlineColour=&H60000000');
  } else {
    style.push('BorderStyle=1', 'Outline=1.5', 'OutlineColour=&H00000000');
  }
  return style.join(',');
}

export function subtitlesFilter(
  source: { path: string; track?: number; encoding?: string },
  style: string,
  fontsDir: string,
): string {
  const parts = [`filename=${escapeFilterValue(source.path)}`];
  if (source.track !== undefined) parts.push(`si=${source.track}`);
  if (source.encoding) parts.push(`charenc=${source.encoding}`);
  parts.push(`fontsdir=${escapeFilterValue(fontsDir)}`);
  parts.push(`force_style=${escapeFilterValue(style)}`);
  return `subtitles=${parts.join(':')}`;
}

export function buildSubtitleBurnArgs(
  options: SubtitleBurnOptions,
  paths: { inputPaths: readonly string[]; outputPath: string; fontsDir?: string },
  inputs: readonly (OperationInput | undefined)[],
): string[] {
  const roles = subtitleRoles(inputs.map((input) => input?.media.kind));
  const videoPath = paths.inputPaths[roles.video];
  const file = roles.subtitles === undefined ? undefined : paths.inputPaths[roles.subtitles];

  const source = file
    ? { path: file, encoding: options.encoding }
    : { path: videoPath, track: options.track };

  const filter = subtitlesFilter(
    source,
    subtitleStyle(options, styledSource(options, inputs)),
    paths.fontsDir ?? FONTS_DIR,
  );

  return [
    '-i',
    videoPath,
    '-vf',
    filter,
    // Only the picture and the sound: an MKV's own subtitle tracks would
    // otherwise be carried into an MP4 that cannot hold them.
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  ];
}

/** Whether the subtitles bring their own styling, from the file or from the track. */
function styledSource(
  options: SubtitleBurnOptions,
  inputs: readonly (OperationInput | undefined)[],
): boolean {
  const roles = subtitleRoles(inputs.map((input) => input?.media.kind));
  if (roles.subtitles !== undefined) return isStyled(inputs[roles.subtitles]?.media.extension);
  return isStyled(inputs[roles.video]?.info?.subtitles?.[options.track]?.codec);
}

function aligned(context: OperationContext): readonly OperationInput[] {
  return context.inputs ?? [];
}

function videoInput(context: OperationContext): OperationInput | undefined {
  const inputs = aligned(context);
  return inputs[subtitleRoles(inputs.map((input) => input.media.kind)).video];
}

function hasFile(context: OperationContext): boolean {
  return aligned(context).some((input) => input.media.kind === 'subtitle');
}

export const subtitleBurn = defineOperation<SubtitleBurnOptions>({
  id: 'subtitle-burn',
  route: 'burn-subtitles',
  title: 'Burn in subtitles',
  verb: 'Burn in',
  summary: 'Draw subtitles into the picture, from a subtitle file or from the video itself.',
  group: 'subtitle',
  accepts: ['video', 'subtitle'],
  inputs: { min: 1, max: 2 },
  requires: ['video'],
  needs: 'A video file, and a subtitle file unless the video has its own',
  needsBrief: 'Video + subtitles',
  fonts: true,
  defaults: DEFAULT_SUBTITLE_BURN,
  outputSuffix: 'subtitled',

  rejects: (context) => {
    const kinds = aligned(context).map((input) => input.media.kind);
    if (kinds.filter((kind) => kind === 'video').length > 1) {
      return 'This takes one video, and a subtitle file if it has none of its own.';
    }
    if (kinds.filter((kind) => kind === 'subtitle').length > 1) {
      return 'This takes one subtitle file at a time.';
    }
    const video = videoInput(context)?.info;
    if (video?.hasVideo === false) return 'The video has no picture to put subtitles on.';
    return hasFile(context) ? undefined : trackProblem(video);
  },

  fields: [
    {
      kind: 'select',
      key: 'track',
      label: 'Track',
      choices: (_options, context) => trackChoices(videoInput(context)?.info),
      visibleWhen: (_options, context) => !hasFile(context),
    },
    {
      kind: 'slider',
      key: 'size',
      label: 'Size',
      min: 3,
      max: 12,
      step: 0.5,
      display: (options) => `${options.size}% of the height`,
      endLabels: ['Small', 'Large'],
      visibleWhen: (options, context) => !styledSource(options, aligned(context)),
    },
    {
      kind: 'segmented',
      key: 'position',
      label: 'Where',
      choices: [
        { value: 'bottom', label: 'Bottom' },
        { value: 'top', label: 'Top' },
      ],
      visibleWhen: (options, context) => !styledSource(options, aligned(context)),
    },
    {
      kind: 'segmented',
      key: 'style',
      label: 'Style',
      choices: [
        { value: 'outline', label: 'Outline' },
        { value: 'box', label: 'Box behind' },
      ],
      visibleWhen: (options, context) => !styledSource(options, aligned(context)),
    },
    {
      kind: 'toggle',
      key: 'bold',
      label: 'Bold',
      visibleWhen: (options, context) => !styledSource(options, aligned(context)),
    },
    {
      kind: 'select',
      key: 'encoding',
      label: 'Text encoding',
      choices: ENCODING_CHOICES,
      hint: ENCODING_HINT,
      visibleWhen: (_options, context) => hasFile(context),
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      min: 0,
      max: 100,
      step: 1,
      endLabels: ['Smaller file', 'Better picture'],
      display: (options) => `${options.quality} · CRF ${qualityToCrf(options.quality, 'h264')}`,
    },
  ],

  normalize: (options, context) => {
    const info = videoInput(context)?.info;
    const track = info?.subtitles?.[options.track];
    if (track && !track.text) return { ...options, track: firstTextTrack(info) ?? 0 };
    return options;
  },

  preflight: (options, context) => {
    const warnings: string[] = [];
    if (hasFile(context) && options.encoding && CJK_ENCODINGS.has(options.encoding)) {
      warnings.push(
        'The only font Cinch carries has no Chinese, Japanese or Korean letters, so they would show as empty boxes.',
      );
    }
    if (styledSource(options, aligned(context))) {
      warnings.push(
        'These subtitles bring their own styling, which is kept. Only the font is swapped for DejaVu Sans.',
      );
    }
    return warnings;
  },

  build: (options, paths, context) => {
    // Without a context (the registry's smoke test) there is one entry per path.
    const inputs = paths.inputPaths.map((_path, index) => context.inputs?.[index]);
    return buildSubtitleBurnArgs(options, paths, inputs);
  },
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',
  outputDuration: (_options, context) => videoInput(context)?.info?.durationSeconds,

  // Same frame, same length.
  estimateBytes: (_options, context) => sameSizeEstimate(videoInput(context)?.info),
});
