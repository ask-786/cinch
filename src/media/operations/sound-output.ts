import { AUDIO_MIME, audioCodecArgs, isLossless, type AudioFormat } from './audio-extract';
import type { OperationContext } from './descriptor';
import { sameSizeEstimate } from './h264-output';
import { opusArgs } from './opus';
import { CONTAINER_MIME, copyContainer } from './video-convert';

/**
 * The tail shared by every operation that changes the sound and leaves the
 * rest alone — volume, fades, loudness.
 *
 * An audio file comes back in its own format wherever the core can write it,
 * so an MP3 made louder is still an MP3. A video keeps its picture exactly as
 * it was (copied, not re-encoded) and only its sound track is written again.
 */

/** What each audio extension is written back as. Anything else becomes MP3. */
const SAME_FORMAT: Readonly<Record<string, AudioFormat>> = {
  mp3: 'mp3',
  m4a: 'm4a',
  aac: 'm4a',
  alac: 'm4a',
  opus: 'opus',
  ogg: 'ogg',
  oga: 'ogg',
  wav: 'wav',
  aif: 'wav',
  aiff: 'wav',
  flac: 'flac',
};

/** High enough that a second generation of lossy sound goes unnoticed. */
export const SOUND_KBPS = 192;

/** The steps a lossy audio file is written at: the source's own, rounded up. */
const KBPS_STEPS = [128, 160, 192, 256, 320] as const;

/**
 * A 128 kbps MP3 made louder should not come back half as big again, and a
 * 320 kbps one should not lose its headroom. So the source's bitrate is
 * matched — rounded up to a standard step, and never below 128, where a second
 * generation starts to be heard.
 */
export function soundKbps(context: OperationContext): number {
  const bitrate = context.info?.bitrate;
  if (bitrate === undefined || isVideoInput(context)) return SOUND_KBPS;
  const kbps = bitrate / 1000;
  return KBPS_STEPS.find((step) => step >= kbps - 1) ?? KBPS_STEPS.at(-1)!;
}

export function isVideoInput(context: OperationContext): boolean {
  return context.media?.kind === 'video';
}

export function soundFormat(context: OperationContext): AudioFormat {
  return SAME_FORMAT[context.media?.extension ?? ''] ?? 'mp3';
}

export function soundExtension(context: OperationContext): string {
  return isVideoInput(context) ? copyContainer(context.info) : soundFormat(context);
}

export function soundMime(context: OperationContext): string {
  return isVideoInput(context)
    ? CONTAINER_MIME[copyContainer(context.info)]
    : AUDIO_MIME[soundFormat(context)];
}

/** Opus runs at 48 kHz and nothing else, so a sample rate we set must bend to it. */
export function writesOpus(context: OperationContext): boolean {
  return isVideoInput(context)
    ? copyContainer(context.info) === 'webm'
    : soundFormat(context) === 'opus';
}

/** Everything after the filter: which streams to keep and how to write them. */
export function soundCodecArgs(context: OperationContext): string[] {
  if (isVideoInput(context)) {
    const container = copyContainer(context.info);
    const audio =
      container === 'webm' ? opusArgs(SOUND_KBPS) : ['-c:a', 'aac', '-b:a', `${SOUND_KBPS}k`];
    const args = ['-c:v', 'copy', ...audio];
    if (container === 'mp4') args.push('-movflags', '+faststart');
    return args;
  }

  const format = soundFormat(context);
  // -vn drops cover art: not every format can carry it, and a failed job over
  // a thumbnail would be a poor trade.
  const args = ['-vn', ...audioCodecArgs(format)];
  if (!isLossless(format)) args.push('-b:a', `${soundKbps(context)}k`);
  return args;
}

/** `-i in -af <filter> <tail> out`, the whole command for most sound operations. */
export function buildSoundArgs(
  filter: string,
  paths: { inputPath: string; outputPath: string },
  context: OperationContext,
  extra: readonly string[] = [],
): string[] {
  return [
    '-i',
    paths.inputPath,
    '-af',
    filter,
    ...extra,
    ...soundCodecArgs(context),
    paths.outputPath,
  ];
}

export function soundEstimate(context: OperationContext): number | undefined {
  if (isVideoInput(context)) return sameSizeEstimate(context.info);
  // A lossless file written back losslessly is the best guess at its own size.
  if (isLossless(soundFormat(context))) return context.media?.size;
  const seconds = context.info?.durationSeconds;
  if (seconds === undefined) return undefined;
  return Math.round((seconds * soundKbps(context) * 1000) / 8);
}

export function rejectSilent(context: OperationContext): string | undefined {
  return context.info?.hasAudio === false ? 'This file has no sound in it.' : undefined;
}
