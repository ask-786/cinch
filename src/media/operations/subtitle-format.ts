import type { MediaInfo, SubtitleTrack } from '../models/media-info';
import type { Choice } from './descriptor';

/**
 * What the three subtitle operations share: the formats they write, the
 * encodings an old subtitle file might be in, and how a track is named.
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

const FORMATS: Readonly<Record<SubtitleFormat, { codec: string; mime: string }>> = {
  srt: { codec: 'srt', mime: 'application/x-subrip' },
  vtt: { codec: 'webvtt', mime: 'text/vtt' },
  ass: { codec: 'ass', mime: 'text/x-ssa' },
};

export function subtitleCodec(format: SubtitleFormat): string {
  return FORMATS[format].codec;
}

export function subtitleMime(format: SubtitleFormat): string {
  return FORMATS[format].mime;
}

export const FORMAT_CHOICES: readonly Choice[] = [
  { value: 'srt', label: 'SRT', note: 'plays everywhere' },
  { value: 'vtt', label: 'WebVTT', note: 'for the web' },
  { value: 'ass', label: 'ASS', note: 'keeps styling' },
];

/**
 * FFmpeg reads subtitles as UTF-8 and stops at the first byte that is not.
 * Older files, especially SRT, are often in a Windows code page, which only
 * the person who has the file can name — the bytes alone do not say.
 * Every one of these was converted correctly by the core's iconv.
 */
export const ENCODING_CHOICES: readonly Choice[] = [
  { value: undefined, label: 'UTF-8', note: 'most files' },
  { value: 'CP1252', label: 'Western European' },
  { value: 'CP1250', label: 'Central European' },
  { value: 'CP1251', label: 'Cyrillic' },
  { value: 'CP1253', label: 'Greek' },
  { value: 'CP1254', label: 'Turkish' },
  { value: 'CP1255', label: 'Hebrew' },
  { value: 'CP1256', label: 'Arabic' },
  { value: 'GB18030', label: 'Chinese, simplified' },
  { value: 'BIG5', label: 'Chinese, traditional' },
  { value: 'SHIFT_JIS', label: 'Japanese' },
  { value: 'EUC-KR', label: 'Korean' },
];

export const ENCODING_HINT = 'Change this only if FFmpeg says the text is not UTF-8.';

/** The encodings whose letters the bundled font does not have. */
export const CJK_ENCODINGS: ReadonlySet<string> = new Set([
  'GB18030',
  'BIG5',
  'SHIFT_JIS',
  'EUC-KR',
]);

const CODEC_NAMES: Readonly<Record<string, string>> = {
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MP4 text',
  dvd_subtitle: 'DVD pictures',
  hdmv_pgs_subtitle: 'Blu-ray pictures',
  dvb_subtitle: 'DVB pictures',
};

/** Keeps the author's fonts, colours and positions, so it is not restyled. */
export function isStyled(codec: string | undefined): boolean {
  return codec === 'ass' || codec === 'ssa';
}

/** "English · SRT", "Track 2 · Signs · ASS". */
export function trackLabel(track: SubtitleTrack, index: number): string {
  const parts = [languageName(track.language) ?? `Track ${index + 1}`];
  if (track.title) parts.push(track.title);
  parts.push(CODEC_NAMES[track.codec] ?? track.codec);
  return parts.join(' · ');
}

/**
 * One choice per track, picture tracks shown but not choosable. Before
 * ffprobe has answered there is nothing to list, so the first track stands in.
 */
export function trackChoices(info: MediaInfo | undefined): readonly Choice[] {
  const tracks = info?.subtitles;
  if (!tracks?.length) return [{ value: 0, label: 'The first track' }];
  return tracks.map((track, index) => ({
    value: index,
    label: trackLabel(track, index),
    disabled: !track.text,
  }));
}

export function firstTextTrack(info: MediaInfo | undefined): number | undefined {
  const index = info?.subtitles?.findIndex((track) => track.text) ?? -1;
  return index === -1 ? undefined : index;
}

/**
 * Why a video's own tracks cannot be used, once ffprobe has read them. Before
 * then there is no telling, so it says nothing.
 */
export function trackProblem(info: MediaInfo | undefined): string | undefined {
  const tracks = info?.subtitles;
  if (info?.source !== 'ffprobe' || tracks === undefined) return undefined;
  if (tracks.length === 0) return 'This video has no subtitles in it.';
  if (!tracks.some((track) => track.text)) {
    return 'Its subtitles are pictures, as on a DVD or Blu-ray, and cannot be turned into text.';
  }
  return undefined;
}

/** `eng` → English. Unknown or odd codes come back as they are. */
function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
