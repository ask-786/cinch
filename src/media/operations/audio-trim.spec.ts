import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import { audioTrim, buildAudioTrimArgs } from './audio-trim';

const media: MediaFile = {
  id: 'f',
  file: new File([], 'talk.flac'),
  name: 'talk.flac',
  size: 1_000_000,
  extension: 'flac',
  kind: 'audio',
};

describe('buildAudioTrimArgs', () => {
  it('seeks fast and copies the sound for the length asked', () => {
    const args = buildAudioTrimArgs(
      { startSeconds: 1.5, endSeconds: 5.5 },
      { inputPath: 'in', outputPath: 'out' },
    );
    expect(args.slice(0, 4)).toEqual(['-ss', '00:00:01.500', '-i', 'in']);
    expect(args[args.indexOf('-t') + 1]).toBe('00:00:04.000');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
  });
});

describe('the audio trim descriptor', () => {
  const info = { source: 'ffprobe' as const, kind: 'audio' as const, durationSeconds: 100 };

  it('keeps the file’s own format', () => {
    expect(audioTrim.outputExtension({} as never, { media })).toBe('flac');
    expect(audioTrim.outputMime({} as never, { media })).toBe('audio/flac');
  });

  it('opens on the whole file once the length is known', () => {
    expect(audioTrim.normalize?.({ startSeconds: 0, endSeconds: 0 }, { info })).toEqual({
      startSeconds: 0,
      endSeconds: 100,
    });
  });

  it('estimates from the share of the file kept', () => {
    expect(audioTrim.estimateBytes?.({ startSeconds: 0, endSeconds: 25 }, { media, info })).toBe(
      250_000,
    );
  });
});
