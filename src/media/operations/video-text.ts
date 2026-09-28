import { fontPath } from '../ffmpeg/font-assets';
import { defineOperation } from './descriptor';
import { escapeFilterValue } from './filter-escape';
import { h264OutputArgs, sameSizeEstimate } from './h264-output';
import { qualityToCrf } from './video-compress';

/**
 * Put a line of text over a video: a title, a caption, a credit.
 *
 * The size is a share of the frame's height rather than points, so the same
 * setting reads the same on a phone clip and on 4K. It can show for the whole
 * video or only between two times.
 */

export type TextPosition =
  'top' | 'middle' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type TextColor = 'white' | 'yellow' | 'black';

/** An outline reads on any picture; a box reads on a busy one; plain is for flat backgrounds. */
export type TextStyle = 'outline' | 'box' | 'plain';

export type VideoTextOptions = {
  readonly text: string;
  readonly position: TextPosition;
  /** The letters' height as a share of the frame's, in percent. */
  readonly size: number;
  readonly color: TextColor;
  readonly style: TextStyle;
  readonly bold: boolean;
  /** Seconds. Empty means from the start. */
  readonly from?: number;
  /** Seconds. Empty means to the end. */
  readonly to?: number;
  readonly quality: number;
};

export const DEFAULT_TEXT: VideoTextOptions = {
  text: '',
  position: 'bottom',
  size: 7,
  color: 'white',
  style: 'outline',
  bold: true,
  from: undefined,
  to: undefined,
  quality: 60,
};

/** When the video's height is still being read. Only the outline's thickness depends on it. */
const FALLBACK_HEIGHT = 720;

/** The gap from the edge, as a share of the height, so the text never touches it. */
const MARGIN = 'h*0.05';

/** `drawtext` places the text's top-left corner; w and h are the frame's, tw and th the text's. */
export function textPlacement(position: TextPosition): { x: string; y: string } {
  const [vertical, horizontal] = position.includes('-')
    ? position.split('-')
    : [position, 'center'];
  const x = horizontal === 'left' ? MARGIN : horizontal === 'right' ? `w-tw-${MARGIN}` : '(w-tw)/2';
  const y = vertical === 'top' ? MARGIN : vertical === 'bottom' ? `h-th-${MARGIN}` : '(h-th)/2';
  return { x, y };
}

/** `drawtext`'s `enable`, or nothing when it shows throughout. */
export function textWindow(from: number | undefined, to: number | undefined): string | undefined {
  if (from !== undefined && to !== undefined) return `between(t,${from},${to})`;
  if (from !== undefined) return `gte(t,${from})`;
  if (to !== undefined) return `lte(t,${to})`;
  return undefined;
}

export function textFilter(
  options: VideoTextOptions,
  height: number | undefined,
  fontsDir?: string,
): string {
  const fontPixels = ((height ?? FALLBACK_HEIGHT) * options.size) / 100;
  const edge = options.color === 'black' ? 'white' : 'black';
  const { x, y } = textPlacement(options.position);

  const parts = [
    `fontfile=${escapeFilterValue(fontPath(options.bold ? 'bold' : 'regular', fontsDir))}`,
    // Without this, `%{…}` in a caption would be read as a live expression.
    'expansion=none',
    `text=${escapeFilterValue(options.text)}`,
    `fontsize=h*${options.size}/100`,
    `fontcolor=${options.color}`,
    `x=${x}`,
    `y=${y}`,
  ];
  if (options.style === 'outline') {
    parts.push(`borderw=${Math.max(1, Math.round(fontPixels / 16))}`, `bordercolor=${edge}`);
  } else if (options.style === 'box') {
    parts.push('box=1', `boxcolor=${edge}@0.6`, `boxborderw=${Math.round(fontPixels / 4)}`);
  }

  const window = textWindow(options.from, options.to);
  if (window) parts.push(`enable=${escapeFilterValue(window)}`);

  return `drawtext=${parts.join(':')}`;
}

export function buildVideoTextArgs(
  options: VideoTextOptions,
  paths: { inputPath: string; outputPath: string; fontsDir?: string },
  height: number | undefined,
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-vf',
    `${textFilter(options, height, paths.fontsDir)},format=yuv420p`,
    ...h264OutputArgs({ quality: options.quality, audio: 'copy' }),
    paths.outputPath,
  ];
}

export const videoText = defineOperation<VideoTextOptions>({
  id: 'video-text',
  route: 'text',
  title: 'Add text',
  verb: 'Add text',
  summary: 'Put a title or a caption over a video, for all of it or a few seconds.',
  group: 'video',
  accepts: ['video'],
  fonts: true,
  defaults: DEFAULT_TEXT,
  outputSuffix: 'text',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to put text on.' : undefined,

  incomplete: (options) =>
    options.text.trim() === '' ? 'Type the text to put on the video.' : undefined,

  fields: [
    {
      kind: 'text',
      key: 'text',
      label: 'Text',
      placeholder: 'Summer 2026',
      maxLength: 200,
    },
    {
      kind: 'select',
      key: 'position',
      label: 'Where',
      choices: [
        { value: 'top', label: 'Top' },
        { value: 'middle', label: 'In the middle' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
      ],
    },
    {
      kind: 'slider',
      key: 'size',
      label: 'Size',
      min: 3,
      max: 20,
      step: 1,
      display: (options) => `${options.size}% of the height`,
      endLabels: ['Small', 'Large'],
    },
    {
      kind: 'segmented',
      key: 'color',
      label: 'Colour',
      choices: [
        { value: 'white', label: 'White' },
        { value: 'yellow', label: 'Yellow' },
        { value: 'black', label: 'Black' },
      ],
    },
    {
      kind: 'segmented',
      key: 'style',
      label: 'Style',
      choices: [
        { value: 'outline', label: 'Outline' },
        { value: 'box', label: 'Box behind' },
        { value: 'plain', label: 'Plain' },
      ],
    },
    { kind: 'toggle', key: 'bold', label: 'Bold' },
    {
      kind: 'number',
      key: 'from',
      label: 'Show from',
      suffix: 's',
      min: 0,
      step: 0.5,
      placeholder: 'the start',
    },
    {
      kind: 'number',
      key: 'to',
      label: 'Until',
      suffix: 's',
      min: 0,
      step: 0.5,
      placeholder: 'the end',
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

  preflight: (options, context) => {
    const warnings: string[] = [];
    const { from, to } = options;
    if (from !== undefined && to !== undefined && to <= from) {
      warnings.push('The text would stop before it starts, so it would never show.');
    }
    const duration = context.info?.durationSeconds;
    if (from !== undefined && duration !== undefined && from >= duration) {
      warnings.push('The video ends before the text would start.');
    }
    return warnings;
  },

  build: (options, paths, context) => buildVideoTextArgs(options, paths, context.info?.height),
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',

  // Same frame, same length.
  estimateBytes: (_options, context) => sameSizeEstimate(context.info),
});
