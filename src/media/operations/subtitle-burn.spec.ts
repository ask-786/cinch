import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';
import {
  isVisible,
  previewCommand,
  type OperationContext,
  type OperationInput,
} from './descriptor';
import {
  buildSubtitleBurnArgs,
  DEFAULT_SUBTITLE_BURN,
  subtitleBurn,
  subtitleRoles,
  subtitlesFilter,
  subtitleStyle,
  type SubtitleBurnOptions,
} from './subtitle-burn';

const options = (overrides: Partial<SubtitleBurnOptions> = {}): SubtitleBurnOptions => ({
  ...DEFAULT_SUBTITLE_BURN,
  ...overrides,
});

function input(name: string, kind: MediaKind, info?: Partial<MediaInfo>): OperationInput {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return {
    media: { id: name, name, kind, extension } as MediaFile,
    info: info && { source: 'ffprobe', kind, ...info },
  };
}

const film = input('film.mkv', 'video', {
  hasVideo: true,
  durationSeconds: 60,
  bitrate: 2_000_000,
  subtitles: [
    { codec: 'subrip', language: 'eng', text: true },
    { codec: 'ass', language: 'fra', text: true },
  ],
});
const srt = input('film.en.srt', 'subtitle');
const ass = input('karaoke.ass', 'subtitle');

const contextOf = (...inputs: OperationInput[]): OperationContext => ({
  media: inputs[0].media,
  info: inputs[0].info,
  inputs,
});

describe('subtitleRoles', () => {
  it('finds the video and the subtitle file in either order', () => {
    expect(subtitleRoles(['video', 'subtitle'])).toEqual({ video: 0, subtitles: 1 });
    expect(subtitleRoles(['subtitle', 'video'])).toEqual({ video: 1, subtitles: 0 });
  });

  it('has no file role for a video alone', () => {
    expect(subtitleRoles(['video'])).toEqual({ video: 0 });
  });
});

describe('subtitleStyle', () => {
  it('restyles plain subtitles, sized against libass’s 288-line canvas', () => {
    expect(subtitleStyle(options(), false)).toBe(
      'FontName=DejaVu Sans,FontSize=17,Bold=0,Alignment=2,MarginV=14,Shadow=0,' +
        'BorderStyle=1,Outline=1.5,OutlineColour=&H00000000',
    );
  });

  it('puts them at the top with the legacy alignment, in a see-through box', () => {
    const style = subtitleStyle(options({ position: 'top', style: 'box', bold: true }), false);
    expect(style).toContain('Alignment=6');
    expect(style).toContain('Bold=1');
    expect(style).toContain('BorderStyle=3,Outline=2,OutlineColour=&H60000000');
  });

  it('only swaps the font of subtitles that bring their own styling', () => {
    expect(subtitleStyle(options(), true)).toBe('FontName=DejaVu Sans');
  });
});

describe('subtitlesFilter', () => {
  it('escapes the path and the style list for the graph', () => {
    expect(
      subtitlesFilter(
        { path: "/mnt2/Bob's [2020].srt", encoding: 'CP1252' },
        'FontName=DejaVu Sans,Bold=0',
        '/fonts',
      ),
    ).toBe(
      "subtitles=filename=/mnt2/Bob\\\\\\'s \\[2020\\].srt:charenc=CP1252" +
        ':fontsdir=/fonts:force_style=FontName=DejaVu Sans\\,Bold=0',
    );
  });

  it('picks a track of the video instead of a file', () => {
    expect(subtitlesFilter({ path: '/mnt1/film.mkv', track: 1 }, 'x', '/fonts')).toContain(
      'filename=/mnt1/film.mkv:si=1:',
    );
  });
});

describe('buildSubtitleBurnArgs', () => {
  const paths = (...inputPaths: string[]) => ({
    inputPaths,
    outputPath: '/out.mp4',
    fontsDir: '/fonts',
  });

  it('draws a given file over the video, whichever order they came in', () => {
    const args = buildSubtitleBurnArgs(options(), paths('/m1/film.en.srt', '/m2/film.mkv'), [
      srt,
      film,
    ]);
    expect(args.slice(0, 2)).toEqual(['-i', '/m2/film.mkv']);
    expect(args[3]).toMatch(/^subtitles=filename=\/m1\/film\.en\.srt:fontsdir/);
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0? ');
    expect(args.join(' ')).toContain('-c:a copy');
  });

  it('reads the chosen track from the video when there is no file', () => {
    const args = buildSubtitleBurnArgs(options({ track: 1 }), paths('/m1/film.mkv'), [film]);
    expect(args[3]).toContain('filename=/m1/film.mkv:si=1:');
    // The French track is ASS, so only the font is forced.
    expect(args[3]).toMatch(/force_style=FontName=DejaVu Sans$/);
  });

  it('only passes the encoding for a file', () => {
    const own = buildSubtitleBurnArgs(options({ encoding: 'CP1252' }), paths('/m1/film.mkv'), [
      film,
    ]);
    expect(own[3]).not.toContain('charenc');
  });
});

describe('subtitleBurn', () => {
  it('asks for fonts', () => {
    expect(subtitleBurn.fonts).toBe(true);
  });

  it('shows the track picker only without a file, and the encoding only with one', () => {
    const [track] = subtitleBurn.fields;
    const encoding = subtitleBurn.fields.find((field) => field.key === 'encoding')!;
    expect(isVisible(track, options(), contextOf(film))).toBe(true);
    expect(isVisible(track, options(), contextOf(film, srt))).toBe(false);
    expect(isVisible(encoding, options(), contextOf(film))).toBe(false);
    expect(isVisible(encoding, options(), contextOf(film, srt))).toBe(true);
  });

  it('hides the look for an ASS file, which keeps its own', () => {
    const size = subtitleBurn.fields.find((field) => field.key === 'size')!;
    expect(isVisible(size, options(), contextOf(film, srt))).toBe(true);
    expect(isVisible(size, options(), contextOf(film, ass))).toBe(false);
  });

  it('turns away a video with nothing to burn', () => {
    const bare = input('bare.mp4', 'video', { hasVideo: true, subtitles: [] });
    expect(subtitleBurn.rejects?.(contextOf(bare))).toMatch(/no subtitles/);
    expect(subtitleBurn.rejects?.(contextOf(bare, srt))).toBeUndefined();
  });

  it('turns away two videos', () => {
    expect(subtitleBurn.rejects?.(contextOf(film, film))).toMatch(/one video/);
  });

  it('warns that the font has no CJK letters', () => {
    const warnings = subtitleBurn.preflight?.(
      options({ encoding: 'SHIFT_JIS' }),
      contextOf(film, srt),
    );
    expect(warnings?.[0]).toMatch(/empty boxes/);
  });

  it('shows a command that points at a local fonts folder', () => {
    expect(previewCommand(subtitleBurn, options(), contextOf(film, srt))).toContain(
      'fontsdir=fonts',
    );
  });
});
