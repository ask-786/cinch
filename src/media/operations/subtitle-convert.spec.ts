import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import { applyChange, initialOptions, type OperationContext } from './descriptor';
import {
  buildSubtitleConvertArgs,
  DEFAULT_SUBTITLE_CONVERT,
  subtitleConvert,
  targetFormat,
} from './subtitle-convert';

function contextFor(name: string): OperationContext {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  const media = { id: 'f1', name, kind: 'subtitle', extension } as MediaFile;
  return { media, inputs: [{ media }] };
}

const paths = { inputPath: '/in.srt', outputPath: '/out.vtt' };

describe('targetFormat', () => {
  it('turns SRT into WebVTT and everything else into SRT', () => {
    expect(targetFormat(DEFAULT_SUBTITLE_CONVERT, contextFor('film.srt'))).toBe('vtt');
    expect(targetFormat(DEFAULT_SUBTITLE_CONVERT, contextFor('film.vtt'))).toBe('srt');
    expect(targetFormat(DEFAULT_SUBTITLE_CONVERT, contextFor('film.ass'))).toBe('srt');
  });

  it('keeps a format the user chose', () => {
    expect(targetFormat({ format: 'ass' }, contextFor('film.srt'))).toBe('ass');
  });
});

describe('buildSubtitleConvertArgs', () => {
  it('converts with nothing else when nothing else is asked', () => {
    expect(buildSubtitleConvertArgs({}, 'vtt', paths)).toEqual([
      '-i',
      '/in.srt',
      '-c:s',
      'webvtt',
      '/out.vtt',
    ]);
  });

  it('reads the encoding and moves the lines, keeping times below zero from being undone', () => {
    expect(buildSubtitleConvertArgs({ encoding: 'CP1252', shift: -1.5 }, 'srt', paths)).toEqual([
      '-sub_charenc',
      'CP1252',
      '-copyts',
      '-itsoffset',
      '-1.5',
      '-i',
      '/in.srt',
      '-ss',
      '0',
      '-c:s',
      'srt',
      '/out.vtt',
    ]);
  });
});

describe('subtitleConvert', () => {
  it('waits for the file before choosing a format', () => {
    const cold = initialOptions(subtitleConvert, {});
    expect(cold['format']).toBeUndefined();
    expect(applyChange(subtitleConvert, cold, {}, contextFor('film.srt'))).toMatchObject({
      format: 'vtt',
    });
  });

  it('fills in the format once the file is known', () => {
    expect(initialOptions(subtitleConvert, contextFor('film.srt'))).toMatchObject({
      format: 'vtt',
    });
  });

  it('warns that only ASS keeps an ASS file’s styling', () => {
    const context = contextFor('film.ass');
    expect(subtitleConvert.preflight?.({ format: 'srt' }, context)).toHaveLength(1);
    expect(subtitleConvert.preflight?.({ format: 'ass' }, context)).toEqual([]);
  });
});
