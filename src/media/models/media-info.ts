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
  /** ffprobe only: the subtitle tracks, in the order `0:s:N` counts them. */
  readonly subtitles?: readonly SubtitleTrack[];
  /** ffprobe only: each audio track's language, in the order `0:a:N` counts them. */
  readonly audioLanguages?: readonly (string | undefined)[];
  /**
   * ffprobe only: the names of the tags on the file and on its tracks,
   * lowercased — `title`, `creation_time`, `handler_name`. Housekeeping
   * included; telling it apart is up to whoever reads them.
   */
  readonly tags?: { readonly file: readonly string[]; readonly tracks: readonly string[] };
  /** ffprobe only: how many chapters the file is divided into. */
  readonly chapters?: number;
  /** ffprobe only: files carried inside a Matroska file, usually fonts for its subtitles. */
  readonly attachments?: number;
}

export interface SubtitleTrack {
  readonly codec: string;
  /** As tagged, usually ISO 639-2: `eng`, `fra`. */
  readonly language?: string;
  readonly title?: string;
  /**
   * Text can be converted and restyled. DVD and Blu-ray subtitles are
   * pictures, which neither extraction to text nor libass can use.
   */
  readonly text: boolean;
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
