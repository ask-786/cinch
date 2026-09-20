import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';

/**
 * ffprobe writes JSON to a file inside the virtual filesystem and we read it
 * back. Scraping stderr would mean parsing a human-readable format that
 * changes between builds (D5).
 */
export function ffprobeArgs(inputPath: string, outputPath: string): readonly string[] {
  return [
    '-v', 'error',
    '-hide_banner',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    inputPath,
    '-o', outputPath,
  ];
}

interface RawStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly r_frame_rate?: string;
  readonly avg_frame_rate?: string;
  readonly duration?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
}

interface RawProbe {
  readonly streams?: readonly RawStream[];
  readonly format?: {
    readonly duration?: string;
    readonly bit_rate?: string;
    readonly format_name?: string;
  };
}

/**
 * Turns ffprobe's JSON into the same shape the native probe produces, so the
 * info panel does not care which one filled it in.
 *
 * Returns undefined when the payload is not usable — a truncated file or a
 * format ffprobe declined to read.
 */
export function parseFfprobe(json: string, kind: MediaKind): MediaInfo | undefined {
  let raw: RawProbe;
  try {
    raw = JSON.parse(json) as RawProbe;
  } catch {
    return undefined;
  }

  const streams = raw.streams ?? [];
  if (streams.length === 0 && !raw.format) return undefined;

  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  const duration = numberOrUndefined(raw.format?.duration) ?? numberOrUndefined(video?.duration);

  return {
    source: 'ffprobe',
    kind,
    durationSeconds: duration,
    width: video?.width || undefined,
    height: video?.height || undefined,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    frameRate: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    bitrate: numberOrUndefined(raw.format?.bit_rate),
    container: raw.format?.format_name,
    sampleRate: numberOrUndefined(audio?.sample_rate),
    channels: audio?.channels,
  };
}

/** "30000/1001" → 29.97. Rounded, because nobody wants to read 29.970029970029973. */
export function parseFrameRate(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const [numerator, denominator] = value.split('/');
  const top = Number(numerator);
  const bottom = denominator === undefined ? 1 : Number(denominator);

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0 || top === 0) {
    return undefined;
  }

  return Math.round((top / bottom) * 100) / 100;
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
