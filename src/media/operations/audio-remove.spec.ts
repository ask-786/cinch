import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import { audioRemove, buildAudioRemoveArgs } from './audio-remove';

const video = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  hasVideo: true,
  hasAudio: true,
  videoCodec: 'h264',
  ...overrides,
});

describe('buildAudioRemoveArgs', () => {
  it('copies the picture and leaves the sound behind', () => {
    expect(buildAudioRemoveArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' })).toEqual([
      '-i',
      'in.mp4',
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      'out.mp4',
    ]);
  });
});

describe('audioRemove', () => {
  it('keeps an MP4 an MP4, and moves a stream MP4 cannot hold somewhere that can', () => {
    expect(audioRemove.outputExtension({}, { info: video() })).toBe('mp4');
    expect(audioRemove.outputExtension({}, { info: video({ videoCodec: 'vp9' }) })).toBe('webm');
    expect(audioRemove.outputExtension({}, { info: video({ videoCodec: 'theora' }) })).toBe('mkv');
  });

  it('turns away a file that is already silent, or has no picture', () => {
    expect(audioRemove.rejects?.({ info: video({ hasAudio: false }) })).toMatch(/already silent/);
    expect(audioRemove.rejects?.({ info: video({ hasVideo: false }) })).toMatch(/no picture/);
    expect(audioRemove.rejects?.({ info: video() })).toBeUndefined();
  });

  it('estimates the file as the source without its sound', () => {
    const estimate = audioRemove.estimateBytes?.(
      {},
      { info: video({ durationSeconds: 10, bitrate: 1_128_000 }) },
    );
    expect(estimate).toBe(1_250_000);
  });
});
