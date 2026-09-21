import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { OperationInput } from './descriptor';
import {
  audioMerge,
  buildAudioMergeArgs,
  DEFAULT_MERGE,
  mergedSeconds,
  mergeFilter,
  type AudioMergeOptions,
} from './audio-merge';

const options = (overrides: Partial<AudioMergeOptions> = {}): AudioMergeOptions => ({
  ...DEFAULT_MERGE,
  ...overrides,
});

const LAYOUT = 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

function track(name: string, durationSeconds?: number, hasAudio = true): OperationInput {
  return {
    media: { id: name, name, kind: 'audio' } as MediaFile,
    info: { source: 'ffprobe', kind: 'audio', durationSeconds, hasAudio },
  };
}

describe('mergeFilter', () => {
  it('brings every track to one format, then plays them in order', () => {
    expect(mergeFilter(options(), 2)).toBe(
      `[0:a:0]${LAYOUT}[a0];[1:a:0]${LAYOUT}[a1];[a0][a1]concat=n=2:v=0:a=1[a]`,
    );
  });

  it('mixes them at their own levels rather than dividing by the count', () => {
    expect(mergeFilter(options({ mode: 'mix' }), 3)).toContain(
      '[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0[a]',
    );
  });
});

describe('buildAudioMergeArgs', () => {
  it('reads every file and encodes the result once', () => {
    expect(
      buildAudioMergeArgs(options(), { inputPaths: ['a.mp3', 'b.wav'], outputPath: 'out.mp3' }),
    ).toEqual([
      '-i',
      'a.mp3',
      '-i',
      'b.wav',
      '-filter_complex',
      mergeFilter(options(), 2),
      '-map',
      '[a]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      'out.mp3',
    ]);
  });

  it('leaves the bitrate out for a lossless format', () => {
    const args = buildAudioMergeArgs(options({ format: 'flac' }), {
      inputPaths: ['a.mp3', 'b.mp3'],
      outputPath: 'out.flac',
    });
    expect(args).toContain('flac');
    expect(args).not.toContain('-b:a');
  });
});

describe('mergedSeconds', () => {
  it('adds the lengths up when joining and takes the longest when mixing', () => {
    expect(mergedSeconds('join', [30, 45])).toBe(75);
    expect(mergedSeconds('mix', [30, 45])).toBe(45);
  });

  it('knows nothing until every length is known', () => {
    expect(mergedSeconds('join', [30, undefined])).toBeUndefined();
    expect(mergedSeconds('join', [])).toBeUndefined();
  });
});

describe('audioMerge', () => {
  it('names the file that has no sound in it', () => {
    expect(audioMerge.rejects?.({ inputs: [track('a.mp3'), track('b.mp4', 10, false)] })).toBe(
      'b.mp4 has no sound in it.',
    );
  });

  it('estimates from the merged length and the chosen bitrate', () => {
    const inputs = [track('a.mp3', 30), track('b.mp3', 90)];
    expect(audioMerge.estimateBytes?.(options(), { inputs })).toBe(120 * 24_000);
    expect(audioMerge.estimateBytes?.(options({ mode: 'mix' }), { inputs })).toBe(90 * 24_000);
  });
});
