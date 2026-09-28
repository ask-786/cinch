import { describe, expect, it } from 'vitest';
import type { MediaInfo, SubtitleTrack } from '../models/media-info';
import { firstTextTrack, trackChoices, trackLabel, trackProblem } from './subtitle-format';

const srt: SubtitleTrack = { codec: 'subrip', language: 'eng', text: true };
const pgs: SubtitleTrack = { codec: 'hdmv_pgs_subtitle', text: false };
const signs: SubtitleTrack = { codec: 'ass', language: 'fra', title: 'Signs', text: true };

const probed = (subtitles: readonly SubtitleTrack[]): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  subtitles,
});

describe('trackLabel', () => {
  it('names the language, the title and the format', () => {
    expect(trackLabel(srt, 0)).toBe('English · SRT');
    expect(trackLabel(signs, 1)).toBe('French · Signs · ASS');
  });

  it('falls back to the track number without a language', () => {
    expect(trackLabel(pgs, 2)).toBe('Track 3 · Blu-ray pictures');
  });
});

describe('trackChoices', () => {
  it('lists every track and holds back the pictures', () => {
    expect(trackChoices(probed([pgs, srt]))).toEqual([
      { value: 0, label: 'Track 1 · Blu-ray pictures', disabled: true },
      { value: 1, label: 'English · SRT', disabled: false },
    ]);
  });

  it('offers the first track before ffprobe has answered', () => {
    expect(trackChoices(undefined)).toEqual([{ value: 0, label: 'The first track' }]);
  });
});

describe('firstTextTrack', () => {
  it('skips picture tracks', () => {
    expect(firstTextTrack(probed([pgs, srt]))).toBe(1);
    expect(firstTextTrack(probed([pgs]))).toBeUndefined();
  });
});

describe('trackProblem', () => {
  it('says nothing until ffprobe has read the file', () => {
    expect(trackProblem({ source: 'native', kind: 'video' })).toBeUndefined();
  });

  it('turns away a video with no subtitles, or only pictures', () => {
    expect(trackProblem(probed([]))).toMatch(/no subtitles/);
    expect(trackProblem(probed([pgs]))).toMatch(/pictures/);
    expect(trackProblem(probed([pgs, srt]))).toBeUndefined();
  });
});
