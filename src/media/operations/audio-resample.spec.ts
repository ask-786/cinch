import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { OperationContext } from './descriptor';
import {
  audioResample,
  buildAudioResampleArgs,
  DEFAULT_RESAMPLE,
  resolvedFormat,
  type AudioResampleOptions,
} from './audio-resample';

const paths = { inputPath: 'in', outputPath: 'out' };

function context(name: string, info: OperationContext['info'] = undefined): OperationContext {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  const media: MediaFile = {
    id: 'f',
    file: new File([], name),
    name,
    size: 1,
    extension,
    kind: 'audio',
  };
  return { media, info };
}

function options(overrides: Partial<AudioResampleOptions> = {}): AudioResampleOptions {
  return { ...DEFAULT_RESAMPLE, ...overrides };
}

describe('buildAudioResampleArgs', () => {
  it('keeps the source format when asked to', () => {
    expect(resolvedFormat(options(), context('talk.flac'))).toBe('flac');
    const args = buildAudioResampleArgs(options(), paths, context('talk.m4a'));
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
  });

  it('sets the rate, bitrate and channels', () => {
    const args = buildAudioResampleArgs(
      options({ format: 'mp3', kbps: 64, sampleRate: 22_050, channels: 'mono' }),
      paths,
      context('talk.wav'),
    );
    expect(args[args.indexOf('-b:a') + 1]).toBe('64k');
    expect(args[args.indexOf('-ar') + 1]).toBe('22050');
    expect(args[args.indexOf('-ac') + 1]).toBe('1');
  });

  it('never gives Opus a rate, which it would refuse', () => {
    const args = buildAudioResampleArgs(
      options({ format: 'opus', sampleRate: 44_100 }),
      paths,
      context('a.mp3'),
    );
    expect(args).not.toContain('-ar');
  });

  it('leaves the bitrate off a lossless format', () => {
    const args = buildAudioResampleArgs(options({ format: 'wav' }), paths, context('a.mp3'));
    expect(args).not.toContain('-b:a');
  });
});

describe('the resample descriptor', () => {
  it('warns that MP3 caps the bitrate at low sample rates', () => {
    const warnings = audioResample.preflight?.(
      options({ format: 'mp3', kbps: 320, sampleRate: 22_050 }) as never,
      context('a.wav'),
    );
    expect(warnings?.join(' ')).toMatch(/160 kbps/);
  });

  it('estimates a WAV from its samples', () => {
    const bytes = audioResample.estimateBytes?.(
      options({ format: 'wav', sampleRate: 44_100, channels: 'stereo' }) as never,
      context('a.mp3', { source: 'ffprobe', kind: 'audio', durationSeconds: 10 }),
    );
    expect(bytes).toBe(10 * 44_100 * 2 * 2);
  });
});
