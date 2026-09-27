import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import type { OperationContext } from './descriptor';
import {
  buildSoundArgs,
  soundCodecArgs,
  soundEstimate,
  soundExtension,
  soundKbps,
  soundMime,
  writesOpus,
} from './sound-output';

const paths = { inputPath: '/mnt1/in', outputPath: '/out' };

function file(name: string, kind: MediaFile['kind']): MediaFile {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return { id: 'f1', file: new File([], name), name, size: 1000, extension, kind };
}

function context(
  name: string,
  kind: MediaFile['kind'],
  info?: Partial<MediaInfo>,
): OperationContext {
  return { media: file(name, kind), info: info && { source: 'ffprobe', kind, ...info } };
}

describe('sound output', () => {
  it('writes an audio file back in its own format', () => {
    expect(soundExtension(context('talk.flac', 'audio'))).toBe('flac');
    expect(soundExtension(context('talk.aac', 'audio'))).toBe('m4a');
    expect(soundMime(context('talk.mp3', 'audio'))).toBe('audio/mpeg');
  });

  it('falls back to MP3 for a format the core cannot write', () => {
    expect(soundExtension(context('talk.wma', 'audio'))).toBe('mp3');
  });

  it('leaves a lossless format without a bitrate', () => {
    expect(soundCodecArgs(context('talk.wav', 'audio'))).not.toContain('-b:a');
    expect(soundCodecArgs(context('talk.mp3', 'audio'))).toContain('-b:a');
  });

  it('copies a video’s picture and re-encodes only its sound', () => {
    const args = soundCodecArgs(context('clip.mp4', 'video', { videoCodec: 'h264' }));
    expect(args.slice(0, 2)).toEqual(['-c:v', 'copy']);
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args).toContain('+faststart');
  });

  it('gives a WebM video Opus, held at the complexity the core survives', () => {
    const webm = context('clip.webm', 'video', { videoCodec: 'vp9' });
    expect(soundExtension(webm)).toBe('webm');
    expect(writesOpus(webm)).toBe(true);
    const args = soundCodecArgs(webm);
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args).toContain('-compression_level');
  });

  it('puts the filter between the input and the codecs', () => {
    const args = buildSoundArgs('volume=6dB', paths, context('a.mp3', 'audio'), ['-ar', '44100']);
    expect(args.slice(0, 4)).toEqual(['-i', '/mnt1/in', '-af', 'volume=6dB']);
    expect(args.indexOf('-ar')).toBeLessThan(args.indexOf('-c:a'));
    expect(args.at(-1)).toBe('/out');
  });

  it('matches the source bitrate, rounded up to a standard step', () => {
    expect(soundKbps(context('a.mp3', 'audio', { bitrate: 128_000 }))).toBe(128);
    expect(soundKbps(context('a.mp3', 'audio', { bitrate: 170_000 }))).toBe(192);
    expect(soundKbps(context('a.mp3', 'audio', { bitrate: 64_000 }))).toBe(128);
    expect(soundKbps(context('a.mp3', 'audio', { bitrate: 900_000 }))).toBe(320);
    expect(soundKbps(context('a.mp3', 'audio'))).toBe(192);
  });

  it('estimates a lossless file at its own size', () => {
    expect(soundEstimate(context('a.flac', 'audio', { durationSeconds: 10 }))).toBe(1000);
  });
});
