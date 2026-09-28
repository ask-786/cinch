import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import { buildMetadataStripArgs, describeMetadata, metadataStrip } from './metadata-strip';

const media = (name: string, type = ''): MediaFile => ({
  id: 'f1',
  file: new File([], name, { type }),
  name,
  size: 5_000_000,
  extension: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
  kind: /\.(mp3|m4a|flac|alac)$/i.test(name) ? 'audio' : 'video',
});

const probed = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  hasVideo: true,
  hasAudio: true,
  tags: { file: [], tracks: [] },
  chapters: 0,
  attachments: 0,
  ...overrides,
});

const paths = { inputPath: 'in.mkv', outputPath: 'out.mkv' };

describe('buildMetadataStripArgs', () => {
  it('copies every picture, sound and subtitle, and nothing that describes them', () => {
    expect(buildMetadataStripArgs({ keepLanguages: false }, paths)).toEqual([
      '-i',
      'in.mkv',
      '-map',
      '0:v?',
      '-map',
      '0:a?',
      '-map',
      '0:s?',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c',
      'copy',
      '-fflags',
      '+bitexact',
      'out.mkv',
    ]);
  });

  it('keeps attachments, and the name and type they cannot be written without', () => {
    const args = buildMetadataStripArgs(
      { keepLanguages: false },
      paths,
      probed({ attachments: 2 }),
    );
    expect(args.join(' ')).toContain(
      '-map 0:s? -map 0:t -map_metadata -1 -map_metadata:s:t 0:s:t -map_chapters -1',
    );
  });

  it('leaves attachments alone when there are none, since mapping their tags would abort', () => {
    expect(buildMetadataStripArgs({ keepLanguages: false }, paths, probed())).not.toContain(
      '-map_metadata:s:t',
    );
  });

  it('puts back the languages it knows, track by track', () => {
    const info = probed({
      audioLanguages: ['spa', undefined],
      subtitles: [
        { codec: 'subrip', language: 'eng', text: true },
        { codec: 'ass', language: 'fra', text: true },
      ],
    });
    const args = buildMetadataStripArgs({ keepLanguages: true }, paths, info);
    expect(args.slice(-9)).toEqual([
      '-metadata:s:a:0',
      'language=spa',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata:s:s:1',
      'language=fra',
      '-fflags',
      '+bitexact',
      'out.mkv',
    ]);
    expect(args).not.toContain('-metadata:s:a:1');
  });

  it('drops the languages too when asked', () => {
    const info = probed({ audioLanguages: ['spa'] });
    expect(buildMetadataStripArgs({ keepLanguages: false }, paths, info)).not.toContain(
      'language=spa',
    );
  });
});

describe('describeMetadata', () => {
  it('says in plain words what the file gives away', () => {
    const info = probed({
      tags: {
        file: [
          'major_brand',
          'title',
          'com.apple.quicktime.location.iso6709',
          'com.apple.quicktime.model',
          'com.apple.quicktime.software',
          'comment',
          'artist',
        ],
        tracks: ['creation_time', 'handler_name', 'title'],
      },
      chapters: 2,
    });
    expect(describeMetadata(info)).toBe(
      'This file carries a title, a location, a date, the camera or phone, the software that made it, a comment, names and 2 chapters.',
    );
  });

  it('counts what it has no word for', () => {
    const info = probed({ tags: { file: ['title', 'lyrics'], tracks: ['isrc'] }, chapters: 1 });
    expect(describeMetadata(info)).toBe('This file carries a title, 1 chapter and 2 other tags.');
  });

  it('says so when there is nothing to take out but what every muxer writes', () => {
    expect(describeMetadata(probed())).toBe('FFmpeg found no tags or chapters in this file.');
    const housekeeping = probed({
      tags: {
        file: ['major_brand', 'encoder'],
        tracks: ['language', 'handler_name', 'encoder', 'duration', 'bps', 'number_of_frames'],
      },
    });
    expect(describeMetadata(housekeeping)).toBe('FFmpeg found no tags or chapters in this file.');
  });

  it('counts mkvmerge’s signature as software and a date', () => {
    const info = probed({
      tags: { file: [], tracks: ['_statistics_writing_app', '_statistics_writing_date_utc'] },
    });
    expect(describeMetadata(info)).toBe('This file carries a date and the software that made it.');
  });

  it('says nothing until ffprobe has read the file', () => {
    expect(describeMetadata({ source: 'native', kind: 'video' })).toBeUndefined();
    expect(describeMetadata(undefined)).toBeUndefined();
  });
});

describe('metadataStrip', () => {
  it('writes the same kind of file it was given', () => {
    const options = { keepLanguages: true };
    expect(metadataStrip.outputExtension(options, { media: media('trip.MOV') })).toBe('mov');
    expect(metadataStrip.outputExtension(options, { media: media('song.flac') })).toBe('flac');
    expect(metadataStrip.outputMime(options, { media: media('a.mp4', 'video/mp4') })).toBe(
      'video/mp4',
    );
  });

  it('writes Apple Lossless into the container it lives in, since FFmpeg has no .alac', () => {
    expect(metadataStrip.outputExtension({ keepLanguages: true }, { media: media('x.alac') })).toBe(
      'm4a',
    );
  });

  it('names the type from the extension it writes, not from what the browser guessed', () => {
    const options = { keepLanguages: true };
    expect(metadataStrip.outputMime(options, { media: media('a.mkv') })).toBe('video/x-matroska');
    expect(metadataStrip.outputMime(options, { media: media('x.alac') })).toBe('audio/mp4');
    expect(metadataStrip.outputMime(options, { media: media('a.avi', 'video/x-msvideo') })).toBe(
      'video/x-msvideo',
    );
  });

  it('warns, rather than blocks, while the file is still being read', () => {
    const cold = { media: media('a.mkv'), info: { source: 'native', kind: 'video' } as MediaInfo };
    expect(metadataStrip.incomplete).toBeUndefined();
    expect(metadataStrip.preflight?.({ keepLanguages: true }, cold)[0]).toMatch(/languages.*fonts/);
    expect(metadataStrip.preflight?.({ keepLanguages: false }, cold)[0]).not.toMatch(/languages/);
    const read = { media: media('a.mkv'), info: probed() };
    expect(metadataStrip.preflight?.({ keepLanguages: true }, read)).toEqual([]);
    expect(metadataStrip.preflight?.({ keepLanguages: true }, {})).toEqual([]);
  });

  it('expects the file to come out the same size, since nothing is re-encoded', () => {
    expect(metadataStrip.estimateBytes?.({ keepLanguages: true }, { media: media('a.mp4') })).toBe(
      5_000_000,
    );
  });
});
