import type { MediaInfo } from '../models/media-info';

export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov';
export type VideoCodec = 'h264' | 'h265' | 'vp9';
export type AudioQuality = 'small' | 'good' | 'high' | 'none';
export type CompressionMode = 'quality' | 'size';

export interface VideoCompressionOptions {
  readonly mode: CompressionMode;
  /** 0–100. Higher means better looking and bigger. */
  readonly quality: number;
  /** Target output size in bytes, used when mode is 'size'. */
  readonly targetBytes?: number;
  readonly format: VideoFormat;
  readonly codec: VideoCodec;
  readonly audio: AudioQuality;
  /** Trades encoding time for a smaller file at the same quality. */
  readonly takeLonger: boolean;
  /** Downscale to this height, keeping the aspect ratio. */
  readonly maxHeight?: number;
}

export const DEFAULT_COMPRESSION: VideoCompressionOptions = {
  mode: 'quality',
  quality: 60,
  format: 'mp4',
  codec: 'h264',
  audio: 'good',
  takeLonger: false,
};

/**
 * Quality slider to CRF, per encoder. CRF is backwards — lower is better — so
 * the slider's 0 maps to the worst value and 100 to the best. 60 lands on the
 * codec's usual sane default (CRF 23 for x264).
 */
const CRF_RANGE: Readonly<Record<VideoCodec, readonly [worst: number, best: number]>> = {
  h264: [34, 16],
  h265: [39, 21],
  vp9: [40, 22],
};

export function qualityToCrf(quality: number, codec: VideoCodec): number {
  const [worst, best] = CRF_RANGE[codec];
  const clamped = Math.min(100, Math.max(0, quality));
  return Math.round(worst - (clamped / 100) * (worst - best));
}

const AUDIO_BITRATE_KBPS: Readonly<Record<Exclude<AudioQuality, 'none'>, number>> = {
  small: 96,
  good: 128,
  high: 192,
};

/** Formats and codecs that actually go together in this build. */
export const FORMAT_CODECS: Readonly<Record<VideoFormat, readonly VideoCodec[]>> = {
  mp4: ['h264', 'h265'],
  mov: ['h264', 'h265'],
  mkv: ['h264', 'h265', 'vp9'],
  webm: ['vp9'],
};

export interface BuildContext {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly info?: MediaInfo;
}

/**
 * Options in, FFmpeg arguments out. Pure — no filesystem, no worker, no
 * globals — which is why this is the layer the tests aim at.
 *
 * The thread count is deliberately absent: it is a property of the core we
 * happen to be running on, not of the operation, and the command shown to the
 * user has to be one they could paste into a terminal (D21).
 */
export function buildVideoCompressionArgs(
  options: VideoCompressionOptions,
  context: BuildContext,
): string[] {
  const args: string[] = ['-i', context.inputPath];

  args.push(...videoArgs(options, context.info));
  args.push(...audioArgs(options));

  if (options.format === 'mp4' || options.format === 'mov') {
    // Puts the index at the front so the file can start playing while it copies.
    args.push('-movflags', '+faststart');
  }

  args.push(context.outputPath);
  return args;
}

function videoArgs(options: VideoCompressionOptions, info?: MediaInfo): string[] {
  const args: string[] = [];
  const scale = scaleFilter(options, info);
  if (scale) args.push('-vf', scale);

  switch (options.codec) {
    case 'h264':
      args.push('-c:v', 'libx264', '-preset', preset(options), '-pix_fmt', 'yuv420p');
      break;
    case 'h265':
      // hvc1 rather than hev1, or QuickTime and Safari refuse to play it.
      args.push('-c:v', 'libx265', '-preset', preset(options), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p');
      break;
    case 'vp9':
      args.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', options.takeLonger ? 'good' : 'realtime');
      break;
  }

  if (options.mode === 'size') {
    const bitrate = videoBitrateBps(options, info);
    if (bitrate !== undefined) {
      const kbps = Math.max(1, Math.round(bitrate / 1000));
      args.push('-b:v', `${kbps}k`);
      // A ceiling and a buffer, so a busy scene cannot blow past the target.
      args.push('-maxrate', `${Math.round(kbps * 1.45)}k`, '-bufsize', `${kbps * 2}k`);
      return args;
    }
    // No duration to divide by — fall through to a quality-based encode.
  }

  const crf = qualityToCrf(options.quality, options.codec);
  args.push('-crf', String(crf));
  if (options.codec === 'vp9') args.push('-b:v', '0');

  return args;
}

function audioArgs(options: VideoCompressionOptions): string[] {
  if (options.audio === 'none') return ['-an'];

  const kbps = AUDIO_BITRATE_KBPS[options.audio];
  // Opus for WebM, AAC everywhere else.
  const codec = options.format === 'webm' ? 'libopus' : 'aac';
  return ['-c:a', codec, '-b:a', `${kbps}k`];
}

function preset(options: VideoCompressionOptions): string {
  return options.takeLonger ? 'medium' : 'veryfast';
}

function scaleFilter(options: VideoCompressionOptions, info?: MediaInfo): string | undefined {
  const target = options.maxHeight;
  if (!target) return undefined;
  if (info?.height !== undefined && info.height <= target) return undefined;

  // -2 keeps the aspect ratio and lands on an even width, which every codec needs.
  return `scale=-2:${target}`;
}

/** Bits per second available to video once audio has taken its share. */
export function videoBitrateBps(
  options: VideoCompressionOptions,
  info?: MediaInfo,
): number | undefined {
  const duration = info?.durationSeconds;
  if (options.targetBytes === undefined || duration === undefined || duration <= 0) {
    return undefined;
  }

  const audioBps = options.audio === 'none' ? 0 : AUDIO_BITRATE_KBPS[options.audio] * 1000;
  // Containers cost a little; 2% covers the index and headers.
  const total = (options.targetBytes * 8 * 0.98) / duration;
  return Math.max(50_000, total - audioBps);
}

/**
 * A rough guess at the output size, for the line under the slider. Calibrated
 * against real x264 output rather than derived: at CRF 23 a 720p30 encode lands
 * near 2.2 Mbit/s, and each 6 points of CRF roughly halves or doubles it.
 */
export function estimateOutputBytes(
  options: VideoCompressionOptions,
  info?: MediaInfo,
): number | undefined {
  if (options.mode === 'size' && options.targetBytes !== undefined) return options.targetBytes;

  const duration = info?.durationSeconds;
  if (duration === undefined || duration <= 0) return undefined;

  const height = options.maxHeight
    ? Math.min(options.maxHeight, info?.height ?? options.maxHeight)
    : info?.height;
  const width = info?.width;
  if (!height || !width) return undefined;

  const scale = info?.height ? height / info.height : 1;
  const pixels = width * scale * height;
  const fps = info?.frameRate ?? 30;

  const crf = qualityToCrf(options.quality, options.codec);
  const bitsPerPixel = 0.08 * Math.pow(2, (23 - crf) / 6);
  // x265 and VP9 buy roughly a third off at the same perceived quality.
  const codecFactor = options.codec === 'h264' ? 1 : 0.65;
  const videoBps = pixels * fps * bitsPerPixel * codecFactor;

  const audioBps = options.audio === 'none' ? 0 : AUDIO_BITRATE_KBPS[options.audio] * 1000;
  return Math.round(((videoBps + audioBps) * duration) / 8);
}

/**
 * The command a person could paste into a terminal (D21). Build the args with
 * the real file names as paths and this just quotes and joins them.
 */
export function toShellCommand(args: readonly string[]): string {
  const quoted = args.map((arg) => (/[\s'"*?$&|<>()]/.test(arg) ? `'${arg.split(`'`).join(`'\\''`)}'` : arg));
  return `ffmpeg ${quoted.join(' ')}`;
}
