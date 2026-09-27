import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import { audioSilence, DEFAULT_SILENCE, reverseBytes, silenceFilter } from './audio-silence';

describe('silenceFilter', () => {
  it('reaches the end by reversing, trimming and reversing back', () => {
    expect(silenceFilter(DEFAULT_SILENCE)).toBe(
      'silenceremove=start_periods=1:start_threshold=-50dB,areverse,' +
        'silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    );
  });

  it('cuts every long pause in one forward pass, keeping a beat of each', () => {
    const filter = silenceFilter({ ...DEFAULT_SILENCE, where: 'all', pause: 2, threshold: -40 });
    expect(filter).not.toContain('areverse');
    expect(filter).toContain('stop_periods=-1');
    expect(filter).toContain('stop_duration=2');
    expect(filter).toContain('stop_threshold=-40dB');
    expect(filter).toContain('stop_silence=0.25');
  });
});

describe('the silence descriptor', () => {
  const long: MediaInfo = {
    source: 'ffprobe',
    kind: 'audio',
    durationSeconds: 3 * 3600,
    sampleRate: 48_000,
    channels: 2,
  };

  it('sizes the reverse buffer as float samples', () => {
    expect(reverseBytes({ ...long, durationSeconds: 10 })).toBe(10 * 48_000 * 2 * 4);
  });

  it('steers a recording too long to reverse to "every pause"', () => {
    const next = audioSilence.normalize?.(DEFAULT_SILENCE as never, { info: long });
    expect(next?.['where']).toBe('all');
  });

  it('keeps "start and end" for a recording that fits', () => {
    const next = audioSilence.normalize?.(DEFAULT_SILENCE as never, {
      info: { ...long, durationSeconds: 600 },
    });
    expect(next?.['where']).toBe('ends');
  });
});
