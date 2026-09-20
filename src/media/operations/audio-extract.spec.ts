import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  audioExtract,
  buildAudioExtractArgs,
  canCopyTrack,
  DEFAULT_AUDIO_EXTRACT,
  isLossless,
  type AudioExtractOptions,
} from './audio-extract';

const paths = { inputPath: '/mnt1/in.mp4', outputPath: '/out.mp3' };

function options(overrides: Partial<AudioExtractOptions> = {}): AudioExtractOptions {
  return { ...DEFAULT_AUDIO_EXTRACT, ...overrides };
}

const aacInfo: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  audioCodec: 'aac',
  hasAudio: true,
  durationSeconds: 120,
};

describe('buildAudioExtractArgs', () => {
  it('always drops the picture', () => {
    expect(buildAudioExtractArgs(options(), paths)).toContain('-vn');
  });

  it('encodes MP3 with LAME at the chosen bitrate', () => {
    const args = buildAudioExtractArgs(options({ bitrate: 'high' }), paths);
    expect(args[args.indexOf('-c:a') + 1]).toBe('libmp3lame');
    expect(args[args.indexOf('-b:a') + 1]).toBe('320k');
  });

  it('leaves the bitrate off a lossless format, where it would mean nothing', () => {
    const args = buildAudioExtractArgs(options({ format: 'flac' }), paths);
    expect(args).not.toContain('-b:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('flac');
  });

  it('copies the track untouched when asked', () => {
    const args = buildAudioExtractArgs(options({ format: 'm4a', bitrate: 'copy' }), paths);
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args).not.toContain('-b:a');
  });
});

describe('canCopyTrack', () => {
  it('matches the source codec against the container', () => {
    expect(canCopyTrack('m4a', 'aac')).toBe(true);
    expect(canCopyTrack('mp3', 'aac')).toBe(false);
    expect(canCopyTrack('wav', 'aac')).toBe(false);
  });

  it('says no when the codec is unknown — a copy that fails costs the whole job', () => {
    expect(canCopyTrack('m4a', undefined)).toBe(false);
  });
});

describe('the extract descriptor', () => {
  const normalize = (values: AudioExtractOptions, info?: MediaInfo) =>
    audioExtract.normalize?.(values, { info }) as unknown as AudioExtractOptions;

  it('turns down a file with no sound in it', () => {
    expect(audioExtract.rejects?.({ info: { ...aacInfo, hasAudio: false } })).toMatch(/no sound/i);
    expect(audioExtract.rejects?.({ info: aacInfo })).toBeUndefined();
  });

  it('drops a copy the chosen format cannot do', () => {
    expect(normalize(options({ format: 'mp3', bitrate: 'copy' }), aacInfo).bitrate).toBe('good');
    expect(normalize(options({ format: 'm4a', bitrate: 'copy' }), aacInfo).bitrate).toBe('copy');
  });

  it('never leaves a lossless format asking for a copy', () => {
    expect(isLossless('wav')).toBe(true);
    expect(normalize(options({ format: 'wav', bitrate: 'copy' }), aacInfo).bitrate).toBe('good');
  });

  it('estimates from the bitrate and the duration', () => {
    const bytes = audioExtract.estimateBytes?.(options({ bitrate: 'good' }) as never, {
      info: aacInfo,
    });
    // 192 kbps for two minutes.
    expect(bytes).toBe(Math.round((192_000 / 8) * 120));
  });

  it('declines to estimate a copy, whose size it cannot know', () => {
    const bytes = audioExtract.estimateBytes?.(
      options({ format: 'm4a', bitrate: 'copy' }) as never,
      { info: aacInfo },
    );
    expect(bytes).toBeUndefined();
  });

  it('warns about a long WAV before it fills the tab', () => {
    const warnings =
      audioExtract.preflight?.(options({ format: 'wav' }) as never, {
        info: { ...aacInfo, durationSeconds: 3600 },
      }) ?? [];
    expect(warnings.join(' ')).toMatch(/FLAC/);
  });
});
