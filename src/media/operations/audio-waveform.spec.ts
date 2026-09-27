import { describe, expect, it } from 'vitest';
import {
  audioWaveform,
  buildAudioWaveformArgs,
  DEFAULT_WAVEFORM,
  waveformFilter,
} from './audio-waveform';

describe('waveformFilter', () => {
  it('folds to one shape on a transparent background by default', () => {
    expect(waveformFilter(DEFAULT_WAVEFORM)).toBe(
      '[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1920x400:colors=0x2563eb:scale=sqrt',
    );
  });

  it('draws a band per channel when asked', () => {
    const filter = waveformFilter({ ...DEFAULT_WAVEFORM, splitChannels: true });
    expect(filter).not.toContain('aformat');
    expect(filter).toContain('split_channels=1');
  });

  it('lays the shape over a solid background', () => {
    const filter = waveformFilter({ ...DEFAULT_WAVEFORM, background: 'white' });
    expect(filter).toContain('color=c=0xffffff:s=1920x400[bg]');
    expect(filter).toContain('[bg][w]overlay');
  });
});

describe('the waveform descriptor', () => {
  it('writes one PNG frame', () => {
    const args = buildAudioWaveformArgs(DEFAULT_WAVEFORM, {
      inputPath: 'in',
      outputPath: 'out.png',
    });
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(audioWaveform.outputExtension(DEFAULT_WAVEFORM as never, {})).toBe('png');
  });
});
