import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import { audioLoudness, loudnessFilter, loudnessRate } from './audio-loudness';

function media(name: string, kind: MediaFile['kind']): MediaFile {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return { id: 'f1', file: new File([], name), name, size: 1, extension, kind };
}

describe('loudnessFilter', () => {
  it('aims for the chosen level with room under the peaks', () => {
    expect(loudnessFilter({ target: -16 })).toBe('loudnorm=I=-16:TP=-1.5:LRA=11');
  });
});

describe('loudnessRate', () => {
  it('puts back the source rate, which loudnorm would leave at 192 kHz', () => {
    expect(
      loudnessRate({
        media: media('a.mp3', 'audio'),
        info: { source: 'ffprobe', kind: 'audio', sampleRate: 44_100 },
      }),
    ).toBe(44_100);
  });

  it('uses 48 kHz for Opus, the only rate it takes', () => {
    expect(
      loudnessRate({
        media: media('a.opus', 'audio'),
        info: { source: 'ffprobe', kind: 'audio', sampleRate: 44_100 },
      }),
    ).toBe(48_000);
  });

  it('passes the rate on the command line', () => {
    const args = audioLoudness.build(
      { target: -14 },
      { inputPath: 'in.mp3', inputPaths: ['in.mp3'], outputPath: 'out.mp3' },
      { media: media('in.mp3', 'audio') },
    );
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
  });
});
