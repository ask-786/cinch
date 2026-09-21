import type { MediaFile } from '../models/media-file';
import { defineOperation } from './descriptor';
import { h264OutputArgs } from './h264-output';
import { DEFAULT_COMPRESSION, estimateOutputBytes } from './video-compress';

/**
 * Cut one long video into pieces of a set length: a lecture into chapters,
 * a recording into parts small enough to send.
 *
 * By default nothing is re-encoded, so it takes seconds, but a copied stream
 * can only be cut on a keyframe and the pieces come out a little uneven. The
 * exact mode re-encodes and forces a keyframe at every boundary instead.
 */

export type SegmentMode = 'fast' | 'exact';

export type VideoSegmentsOptions = {
  /** Seconds per piece. */
  readonly every: number;
  readonly mode: SegmentMode;
};

export const DEFAULT_SEGMENTS: VideoSegmentsOptions = {
  every: 60,
  mode: 'fast',
};

/** Containers the segment muxer writes well, kept when the source is one. */
const KEEPABLE = ['mp4', 'mov', 'mkv', 'webm'];

/** A copied stream stays in its own container; anything else becomes Matroska. */
export function segmentExtension(options: VideoSegmentsOptions, media?: MediaFile): string {
  if (options.mode === 'exact') return 'mp4';
  const extension = media?.extension ?? 'mp4';
  return KEEPABLE.includes(extension) ? extension : 'mkv';
}

export function segmentCount(options: VideoSegmentsOptions, durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / options.every));
}

export function buildVideoSegmentsArgs(
  options: VideoSegmentsOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath, '-map', '0:v:0', '-map', '0:a:0?'];

  if (options.mode === 'exact') {
    args.push(
      '-force_key_frames',
      `expr:gte(t,n_forced*${options.every})`,
      ...h264OutputArgs({ quality: DEFAULT_COMPRESSION.quality, audio: 'reencode' }),
    );
  } else {
    args.push('-c', 'copy');
  }

  args.push(
    '-f',
    'segment',
    '-segment_time',
    String(options.every),
    // Each piece starts at 0:00, so every player shows its own length.
    '-reset_timestamps',
    '1',
    // image2 counts from 1; so do these, and the saved names line up.
    '-segment_start_number',
    '1',
    paths.outputPath,
  );
  return args;
}

export const videoSegments = defineOperation<VideoSegmentsOptions>({
  id: 'video-segments',
  route: 'split',
  title: 'Split into parts',
  verb: 'Split',
  summary: 'Cut a long video into pieces of the same length.',
  group: 'video',
  accepts: ['video'],
  outputs: 'many',
  defaults: DEFAULT_SEGMENTS,
  outputSuffix: 'part',

  rejects: (context) =>
    context.info?.hasVideo === false ? 'This file has no picture to split.' : undefined,

  fields: [
    {
      kind: 'chips',
      key: 'every',
      label: 'Each part',
      choices: [
        { value: 10, label: '10 seconds' },
        { value: 30, label: '30 seconds' },
        { value: 60, label: '1 minute' },
        { value: 300, label: '5 minutes' },
        { value: 600, label: '10 minutes' },
      ],
    },
    {
      kind: 'segmented',
      key: 'mode',
      label: 'Cuts',
      choices: [
        { value: 'fast', label: 'Fast', note: 'on the nearest keyframe' },
        { value: 'exact', label: 'Exact', note: 're-encodes' },
      ],
    },
  ],

  preflight: (options, context) => {
    const duration = context.info?.durationSeconds;
    if (duration === undefined) return [];
    return segmentCount(options, duration) === 1
      ? ['The video is shorter than one part, so this would give back a single file.']
      : [];
  },

  build: (options, paths) => buildVideoSegmentsArgs(options, paths),
  outputExtension: (options, context) => segmentExtension(options, context.media),
  outputMime: (options, context) => {
    const extension = segmentExtension(options, context.media);
    if (extension === 'mkv') return 'video/x-matroska';
    if (extension === 'mov') return 'video/quicktime';
    return `video/${extension}`;
  },

  estimateBytes: (options, context) => {
    // Copied pieces add up to the source; exact ones are a fresh encode.
    if (options.mode === 'fast') return context.media?.size;
    return estimateOutputBytes({ ...DEFAULT_COMPRESSION, audio: 'high' }, context.info);
  },
});
