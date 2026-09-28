import type { MediaInfo } from '../models/media-info';
import { AUDIO_MIME } from './audio-extract';
import { defineOperation } from './descriptor';
import { CONTAINER_MIME } from './video-convert';

/**
 * Take out everything a file says about itself — title, dates, where it was
 * shot, the phone that shot it, chapters — and copy the picture and sound as
 * they are.
 *
 * `-map_metadata -1` drops the file's tags and every track's, including their
 * languages, so a Spanish soundtrack comes out unlabelled. Those are put back
 * from what ffprobe read unless the user wants them gone too. Rotation is side
 * data, not a tag, and survives. `+bitexact` keeps the muxer from signing its
 * own name and version back in.
 *
 * Streams are mapped by type rather than with `-map 0`: a phone's timed
 * metadata track (which can hold the location) is a data stream, and most
 * containers refuse to take one.
 *
 * A Matroska attachment cannot be written without its file name and type, and
 * `-map_metadata -1` takes those too — the core aborts. So attachments keep
 * their own tags. That mapping aborts just the same on a file with no
 * attachments, so it is only added when ffprobe counted some.
 */

export type MetadataStripOptions = {
  readonly keepLanguages: boolean;
};

export function buildMetadataStripArgs(
  options: MetadataStripOptions,
  paths: { inputPath: string; outputPath: string },
  info?: MediaInfo,
): string[] {
  const attachments = (info?.attachments ?? 0) > 0;
  const args = ['-i', paths.inputPath];
  for (const type of ['v', 'a', 's']) args.push('-map', `0:${type}?`);
  if (attachments) args.push('-map', '0:t');
  args.push('-map_metadata', '-1');
  if (attachments) args.push('-map_metadata:s:t', '0:s:t');
  args.push('-map_chapters', '-1', '-c', 'copy');

  if (options.keepLanguages) {
    const tag = (type: string, languages: readonly (string | undefined)[]) =>
      languages.forEach((language, index) => {
        if (language) args.push(`-metadata:s:${type}:${index}`, `language=${language}`);
      });
    tag('a', info?.audioLanguages ?? []);
    tag('s', info?.subtitles?.map((track) => track.language) ?? []);
  }

  args.push('-fflags', '+bitexact', paths.outputPath);
  return args;
}

/**
 * Tags that say nothing about the recording: what a muxer writes on its own,
 * mkvmerge's per-track statistics, and an attachment's name and type. Languages
 * are left out too; they label tracks rather than describe the file. `encoder`
 * is here because FFmpeg stamps it on everything it writes.
 */
const HOUSEKEEPING = new Set([
  'major_brand',
  'minor_version',
  'compatible_brands',
  'handler_name',
  'vendor_id',
  'encoder',
  'language',
  'duration',
  'bps',
  'number_of_frames',
  'number_of_bytes',
  '_statistics_tags',
  'filename',
  'mimetype',
]);

/**
 * Tag names grouped under what they give away. Checked in order; a tag the
 * list has no word for is only counted.
 */
const GIVEAWAYS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)title$/, 'a title'],
  [/location|gps/, 'a location'],
  [/date|creation_time|year/, 'a date'],
  [/make|model|manufacturer/, 'the camera or phone'],
  [/software|writing_app|encoded_by/, 'the software that made it'],
  [/comment|description|synopsis/, 'a comment'],
  [/artist|author|composer|performer|copyright/, 'names'],
];

/**
 * What the file carries, in the user's words — so stripping it is not an act
 * of faith. Says nothing before ffprobe has read the file.
 */
export function describeMetadata(info: MediaInfo | undefined): string | undefined {
  if (info?.source !== 'ffprobe' || info.tags === undefined) return undefined;

  const names = new Set([...info.tags.file, ...info.tags.tracks]);
  const found = new Set<string>();
  let others = 0;
  for (const name of names) {
    if (HOUSEKEEPING.has(name)) continue;
    const giveaway = GIVEAWAYS.find(([pattern]) => pattern.test(name));
    if (giveaway) found.add(giveaway[1]);
    else others++;
  }

  const items = GIVEAWAYS.map(([, label]) => label).filter((label) => found.has(label));
  const chapters = info.chapters ?? 0;
  if (chapters > 0) items.push(`${chapters} chapter${chapters === 1 ? '' : 's'}`);
  if (others > 0) items.push(`${others} other tag${others === 1 ? '' : 's'}`);

  if (items.length === 0) return 'FFmpeg found no tags or chapters in this file.';
  const list =
    items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return `This file carries ${list}.`;
}

/** FFmpeg picks the muxer by extension, and has none called `.alac`. */
function outputExtensionOf(extension: string | undefined): string {
  if (!extension) return 'mkv';
  return extension === 'alac' ? 'm4a' : extension;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = { ...CONTAINER_MIME, ...AUDIO_MIME };

export const metadataStrip = defineOperation<MetadataStripOptions>({
  id: 'metadata-strip',
  route: 'strip-metadata',
  title: 'Strip metadata',
  verb: 'Strip metadata',
  summary:
    'Remove titles, dates, locations, device names and chapters. The picture and sound are copied as they are.',
  // Its own group: under Video, an audio file would get a Video heading.
  group: 'metadata',
  accepts: ['video', 'audio'],
  defaults: { keepLanguages: true },
  fields: [
    {
      key: 'keepLanguages',
      kind: 'toggle',
      label: 'Keep track languages',
      hint: 'So players can still tell the English sound or subtitles from the French.',
    },
  ],
  outputSuffix: 'clean',

  about: (_options, context) => describeMetadata(context.info),

  // The languages and the attachment count come from ffprobe, which the screen
  // starts on open. A file it cannot read can still be tried.
  preflight: (options, context) => {
    if (!context.media || context.info?.source === 'ffprobe') return [];
    return [
      options.keepLanguages
        ? 'FFmpeg is still reading this file. Run it now and the tracks lose their languages, and any fonts it carries are dropped.'
        : 'FFmpeg is still reading this file. Run it now and any fonts it carries are dropped.',
    ];
  },

  build: (options, paths, context) => buildMetadataStripArgs(options, paths, context.info),
  outputExtension: (_options, context) => outputExtensionOf(context.media?.extension),
  outputMime: (_options, context) =>
    MIME_BY_EXTENSION[outputExtensionOf(context.media?.extension)] ??
    (context.media?.file.type || 'application/octet-stream'),

  estimateBytes: (_options, context) => context.media?.size,
});
