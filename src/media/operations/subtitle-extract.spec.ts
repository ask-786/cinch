import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import { applyChange, initialOptions, type OperationContext } from './descriptor';
import {
  buildSubtitleExtractArgs,
  DEFAULT_SUBTITLE_EXTRACT,
  subtitleExtract,
} from './subtitle-extract';

const info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  subtitles: [
    { codec: 'hdmv_pgs_subtitle', text: false },
    { codec: 'subrip', language: 'eng', text: true },
    { codec: 'ass', language: 'fra', text: true },
  ],
};
const media = { id: 'f1', name: 'film.mkv', kind: 'video', extension: 'mkv' } as MediaFile;
const context: OperationContext = { media, info, inputs: [{ media, info }] };

describe('buildSubtitleExtractArgs', () => {
  it('maps the chosen subtitle track and writes it in the chosen format', () => {
    expect(
      buildSubtitleExtractArgs(
        { track: 2, format: 'vtt' },
        { inputPath: '/in.mkv', outputPath: '/out.vtt' },
      ),
    ).toEqual(['-i', '/in.mkv', '-map', '0:s:2', '-c:s', 'webvtt', '/out.vtt']);
  });
});

describe('subtitleExtract', () => {
  it('starts on the first track that is text', () => {
    expect(initialOptions(subtitleExtract, context)).toMatchObject({ track: 1 });
  });

  it('keeps a text track the user picked', () => {
    const next = applyChange(
      subtitleExtract,
      { ...DEFAULT_SUBTITLE_EXTRACT },
      { track: 2 },
      context,
    );
    expect(next).toMatchObject({ track: 2 });
  });

  it('warns that only ASS keeps an ASS track’s styling', () => {
    expect(subtitleExtract.preflight?.({ track: 2, format: 'srt' }, context)).toHaveLength(1);
    expect(subtitleExtract.preflight?.({ track: 2, format: 'ass' }, context)).toEqual([]);
    expect(subtitleExtract.preflight?.({ track: 1, format: 'srt' }, context)).toEqual([]);
  });

  it('names the file after the format', () => {
    expect(subtitleExtract.outputExtension({ track: 1, format: 'vtt' }, context)).toBe('vtt');
    expect(subtitleExtract.outputMime({ track: 1, format: 'vtt' }, context)).toBe('text/vtt');
  });

  it('turns away a video without subtitles', () => {
    expect(subtitleExtract.rejects?.({ ...context, info: { ...info, subtitles: [] } })).toMatch(
      /no subtitles/,
    );
  });
});
