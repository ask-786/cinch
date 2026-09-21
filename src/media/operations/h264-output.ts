import type { MediaInfo } from '../models/media-info';
import { qualityToCrf } from './video-compress';

/**
 * The tail shared by every operation that changes the picture and then has to
 * write it back out — resize, rotate, speed, frame rate.
 *
 * They all want the same thing: H.264 that plays everywhere, the quality
 * slider mapped onto CRF, and the sound left alone unless the operation had a
 * reason to touch it. Keeping it in one place means the defaults move together.
 */

export type AudioHandling = 'copy' | 'reencode' | 'drop';

export interface H264Output {
  readonly quality: number;
  readonly audio: AudioHandling;
}

export function h264OutputArgs(output: H264Output): string[] {
  const args = [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(qualityToCrf(output.quality, 'h264')),
    '-pix_fmt',
    'yuv420p',
  ];

  switch (output.audio) {
    case 'copy':
      args.push('-c:a', 'copy');
      break;
    case 'reencode':
      // A filtered audio track cannot be copied, so it is re-encoded at a
      // bitrate high enough that nobody notices the second generation.
      args.push('-c:a', 'aac', '-b:a', '192k');
      break;
    case 'drop':
      args.push('-an');
      break;
  }

  // Puts the index at the front so the file can start playing while it copies.
  args.push('-movflags', '+faststart');
  return args;
}

/**
 * For the operations that keep the frame and the length — rotate, colour,
 * deinterlace: the source's own bitrate is the best guess available.
 */
export function sameSizeEstimate(info: MediaInfo | undefined): number | undefined {
  if (info?.durationSeconds === undefined || info.bitrate === undefined) return undefined;
  return Math.round((info.bitrate / 8) * info.durationSeconds);
}
