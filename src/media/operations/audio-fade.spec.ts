import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import { audioFade, fadeFilter } from './audio-fade';

const info: MediaInfo = { source: 'ffprobe', kind: 'audio', durationSeconds: 60 };

describe('fadeFilter', () => {
  it('places the fade out that many seconds before the end', () => {
    expect(fadeFilter({ fadeIn: 2, fadeOut: 3 }, 60)).toBe(
      'afade=t=in:st=0:d=2,afade=t=out:st=57:d=3',
    );
  });

  it('skips a fade set to none', () => {
    expect(fadeFilter({ fadeIn: 0, fadeOut: 3 }, 60)).toBe('afade=t=out:st=57:d=3');
  });

  it('cannot place a fade out without the length', () => {
    expect(fadeFilter({ fadeIn: 2, fadeOut: 3 }, undefined)).toBe('afade=t=in:st=0:d=2');
  });

  it('stays a valid command with both fades off', () => {
    expect(fadeFilter({ fadeIn: 0, fadeOut: 0 }, 60)).toBe('anull');
  });
});

describe('the fade descriptor', () => {
  it('warns when the fades are longer than the file', () => {
    const warnings = audioFade.preflight?.(
      { fadeIn: 10, fadeOut: 10 },
      {
        info: { ...info, durationSeconds: 15 },
      },
    );
    expect(warnings?.join(' ')).toMatch(/overlap/);
  });

  it('waits for the length before a fade out can be placed', () => {
    expect(audioFade.preflight?.({ fadeIn: 0, fadeOut: 3 }, {})?.join(' ')).toMatch(
      /still being read/,
    );
  });
});
