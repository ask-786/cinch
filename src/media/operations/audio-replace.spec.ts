import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';
import type { OperationInput } from './descriptor';
import {
  audioReplace,
  buildAudioReplaceArgs,
  DEFAULT_REPLACE,
  replaceFilter,
  replaceRoles,
  type AudioReplaceOptions,
} from './audio-replace';

const PATHS = { inputPaths: ['v.mp4', 's.mp3'], outputPath: 'out.mp4' };

const options = (overrides: Partial<AudioReplaceOptions> = {}): AudioReplaceOptions => ({
  ...DEFAULT_REPLACE,
  ...overrides,
});

function input(name: string, kind: MediaKind, info: Partial<MediaInfo> = {}): OperationInput {
  return {
    media: { id: name, name, kind } as MediaFile,
    info: { source: 'ffprobe', kind, ...info },
  };
}

const clip = input('holiday.mp4', 'video', {
  hasVideo: true,
  hasAudio: true,
  videoCodec: 'h264',
  durationSeconds: 60,
  bitrate: 2_128_000,
});
const song = input('song.mp3', 'audio', { hasAudio: true, durationSeconds: 200 });

describe('replaceRoles', () => {
  it('takes the picture from the video, whichever order the files are in', () => {
    expect(replaceRoles(['video', 'audio'])).toEqual({ picture: 0, sound: 1 });
    expect(replaceRoles(['audio', 'video'])).toEqual({ picture: 1, sound: 0 });
  });

  it('takes the picture from the first of two videos', () => {
    expect(replaceRoles(['video', 'video'])).toEqual({ picture: 0, sound: 1 });
  });
});

describe('replaceFilter', () => {
  it('pads the new sound so it lasts as long as the video', () => {
    expect(replaceFilter(options(), 0, 1)).toBe('[1:a:0]anull,apad[a]');
  });

  it('stops at the shorter of the two when asked', () => {
    expect(replaceFilter(options({ fit: 'shortest' }), 0, 1)).toBe('[1:a:0]anull[a]');
  });

  it('keeps the old sound underneath at the chosen level', () => {
    expect(replaceFilter(options({ mix: 'mix', originalVolume: 30 }), 0, 1)).toBe(
      '[0:a:0]volume=0.30[old];[1:a:0][old]amix=inputs=2:duration=longest:normalize=0,apad[a]',
    );
  });
});

describe('buildAudioReplaceArgs', () => {
  it('copies the picture, re-encodes only the sound, and ends with the video', () => {
    expect(buildAudioReplaceArgs(options(), PATHS, [clip, song])).toEqual([
      '-i',
      'v.mp4',
      '-i',
      's.mp3',
      '-filter_complex',
      '[1:a:0]anull,apad[a]',
      '-map',
      '0:v:0',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
  });

  it('maps the picture from the second file when the song came first', () => {
    const args = buildAudioReplaceArgs(
      options(),
      { inputPaths: ['s.mp3', 'v.mp4'], outputPath: 'out.mp4' },
      [song, clip],
    );
    expect(args).toContain('1:v:0');
    expect(args).toContain('[0:a:0]anull,apad[a]');
  });

  it('falls back to replacing when the video has no sound to keep', () => {
    const quiet = input('quiet.mp4', 'video', { hasAudio: false, videoCodec: 'h264' });
    const args = buildAudioReplaceArgs(options({ mix: 'mix' }), PATHS, [quiet, song]);
    expect(args.join(' ')).not.toContain('amix');
  });

  it('writes Opus when the picture has to stay in WebM', () => {
    const web = input('web.webm', 'video', { videoCodec: 'vp9' });
    const args = buildAudioReplaceArgs(options(), PATHS, [web, song]);
    expect(args).toContain('libopus');
    expect(args).not.toContain('-movflags');
  });
});

describe('audioReplace', () => {
  it('asks for a video among the two files', () => {
    const other = input('other.mp3', 'audio', { hasAudio: true });
    expect(audioReplace.rejects?.({ inputs: [song, other] })).toMatch(/needs to be a video/);
    expect(audioReplace.rejects?.({ inputs: [clip, song] })).toBeUndefined();
  });

  it('names the file that has no sound to give', () => {
    const mute = input('mute.mp4', 'video', { hasAudio: false });
    expect(audioReplace.rejects?.({ inputs: [clip, mute] })).toBe('mute.mp4 has no sound to use.');
  });

  it('lasts as long as the video, or the shorter of the two', () => {
    const short = input('jingle.mp3', 'audio', { hasAudio: true, durationSeconds: 20 });
    expect(audioReplace.outputDuration?.(options(), { inputs: [clip, short] })).toBe(60);
    expect(
      audioReplace.outputDuration?.(options({ fit: 'shortest' }), { inputs: [clip, short] }),
    ).toBe(20);
  });

  it('estimates the picture as it was plus the new sound', () => {
    expect(audioReplace.estimateBytes?.(options(), { inputs: [clip, song] })).toBe(
      ((2_000_000 + 192_000) / 8) * 60,
    );
  });
});
