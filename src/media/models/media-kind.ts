/** What a file is, as far as the UI is concerned. */
export type MediaKind = 'video' | 'audio' | 'image' | 'subtitle';

/**
 * Extension → kind. The browser's `File.type` is unreliable (empty for .mkv on
 * Windows, wrong for .ts, absent for subtitles), so the extension decides and
 * the MIME type is only a fallback.
 */
const BY_EXTENSION: Readonly<Record<string, MediaKind>> = {
  // video
  mp4: 'video', m4v: 'video', mov: 'video', mkv: 'video', webm: 'video',
  avi: 'video', wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video',
  ts: 'video', m2ts: 'video', mts: 'video', ogv: 'video', '3gp': 'video',
  // audio
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', flac: 'audio',
  ogg: 'audio', oga: 'audio', opus: 'audio', wma: 'audio', aiff: 'audio',
  aif: 'audio', alac: 'audio', amr: 'audio', ac3: 'audio',
  // image
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  bmp: 'image', tif: 'image', tiff: 'image', avif: 'image', heic: 'image',
  // subtitle
  srt: 'subtitle', vtt: 'subtitle', ass: 'subtitle', ssa: 'subtitle', sub: 'subtitle',
};

/** Everything the file picker advertises. Drop is validated separately. */
export const ACCEPTED_EXTENSIONS: readonly string[] = Object.keys(BY_EXTENSION);

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Returns undefined for anything Cinch has no business opening. */
export function classify(fileName: string, mimeType = ''): MediaKind | undefined {
  const byExtension = BY_EXTENSION[extensionOf(fileName)];
  if (byExtension) return byExtension;

  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  return undefined;
}

export const KIND_LABELS: Readonly<Record<MediaKind, string>> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  subtitle: 'Subtitles',
};
