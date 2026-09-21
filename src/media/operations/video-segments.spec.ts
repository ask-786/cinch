import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import {
  buildVideoSegmentsArgs,
  DEFAULT_SEGMENTS,
  segmentCount,
  segmentExtension,
  videoSegments,
  type VideoSegmentsOptions,
} from './video-segments';

const PATHS = { inputPath: 'in.mp4', outputPath: '/out-1/%04d.mp4' };

const options = (overrides: Partial<VideoSegmentsOptions> = {}): VideoSegmentsOptions => ({
  ...DEFAULT_SEGMENTS,
  ...overrides,
});

const media = (extension: string, size = 1000) =>
  ({ id: 'a', name: `clip.${extension}`, extension, kind: 'video', size }) as MediaFile;

describe('buildVideoSegmentsArgs', () => {
  it('copies the streams and numbers the pieces from 1', () => {
    expect(buildVideoSegmentsArgs(options({ every: 30 }), PATHS)).toEqual([
      '-i',
      'in.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-f',
      'segment',
      '-segment_time',
      '30',
      '-reset_timestamps',
      '1',
      '-segment_start_number',
      '1',
      '/out-1/%04d.mp4',
    ]);
  });

  it('re-encodes with a keyframe at every boundary for exact cuts', () => {
    const args = buildVideoSegmentsArgs(options({ every: 10, mode: 'exact' }), PATHS);
    expect(args.join(' ')).toContain('-force_key_frames expr:gte(t,n_forced*10) -c:v libx264');
    expect(args).not.toContain('copy');
  });
});

describe('segmentExtension', () => {
  it('keeps a container the segment muxer writes well', () => {
    expect(segmentExtension(options(), media('webm'))).toBe('webm');
    expect(segmentExtension(options(), media('avi'))).toBe('mkv');
  });

  it('writes MP4 once the pieces are re-encoded', () => {
    expect(segmentExtension(options({ mode: 'exact' }), media('webm'))).toBe('mp4');
  });
});

describe('videoSegments', () => {
  it('counts a short last piece as a piece', () => {
    expect(segmentCount(options({ every: 10 }), 25)).toBe(3);
    expect(segmentCount(options({ every: 60 }), 25)).toBe(1);
  });

  it('says so when the video is shorter than one part', () => {
    const context = {
      info: { source: 'ffprobe' as const, kind: 'video' as const, durationSeconds: 40 },
    };
    expect(videoSegments.preflight?.(options({ every: 60 }), context)).toHaveLength(1);
    expect(videoSegments.preflight?.(options({ every: 10 }), context)).toEqual([]);
  });

  it('expects copied pieces to add up to the source', () => {
    expect(videoSegments.estimateBytes?.(options(), { media: media('mp4', 5_000_000) })).toBe(
      5_000_000,
    );
  });
});
