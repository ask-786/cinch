import type { MediaKind } from './media-kind';

/**
 * What we know about a file's contents. Filled in twice: instantly from the
 * browser's own decoders, then more completely once ffprobe has run (Stage 3).
 */
export interface MediaInfo {
  readonly source: 'native' | 'ffprobe';
  readonly kind: MediaKind;
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasVideo?: boolean;
  readonly hasAudio?: boolean;
  /** ffprobe only. */
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly frameRate?: number;
  readonly bitrate?: number;
  readonly container?: string;
  readonly sampleRate?: number;
  readonly channels?: number;
}

/**
 * ffprobe knows more than the browser's decoder, but the browser sometimes
 * answers when ffprobe declines. Prefer the deeper source field by field.
 */
export function mergeInfo(
  native: MediaInfo | undefined,
  probed: MediaInfo | undefined,
): MediaInfo | undefined {
  if (!probed) return native;
  if (!native) return probed;

  return {
    ...probed,
    durationSeconds: probed.durationSeconds ?? native.durationSeconds,
    width: probed.width ?? native.width,
    height: probed.height ?? native.height,
    hasVideo: probed.hasVideo ?? native.hasVideo,
    hasAudio: probed.hasAudio ?? native.hasAudio,
  };
}
