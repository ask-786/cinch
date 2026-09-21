import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';
import { defineOperation, type OperationContext, type OperationInput } from './descriptor';
import { CONTAINER_MIME, copyContainer } from './video-convert';

/**
 * Put a different sound track under a video: music over holiday footage, a
 * cleaned-up voice over a screen recording.
 *
 * Two files go in. The picture comes from the video and the sound from the
 * other one, whichever order they were dropped in, so nobody has to reorder a
 * list to get it right. When both are videos, the first gives the picture and
 * the second the sound. The picture is copied untouched, so only the sound is
 * re-encoded.
 */

export type ReplaceFit = 'video' | 'shortest';
export type ReplaceMix = 'replace' | 'mix';

export type AudioReplaceOptions = {
  /** Which of the two sets the length when they differ. */
  readonly fit: ReplaceFit;
  /** Throw the old sound away, or keep it underneath the new one. */
  readonly mix: ReplaceMix;
  /** 0–100, the old sound's level when it is kept. */
  readonly originalVolume: number;
};

export const DEFAULT_REPLACE: AudioReplaceOptions = {
  fit: 'video',
  mix: 'replace',
  originalVolume: 30,
};

/** Which input gives the picture and which the sound. */
export function replaceRoles(kinds: readonly (MediaKind | undefined)[]): {
  picture: number;
  sound: number;
} {
  const picture = kinds.indexOf('video');
  if (picture <= 0) return { picture: 0, sound: 1 };
  return { picture, sound: 0 };
}

export function replaceFilter(
  options: AudioReplaceOptions,
  picture: number,
  sound: number,
): string {
  // apad makes the new sound as long as it needs to be; -shortest then stops at
  // the end of the picture, so a longer song is cut there and a shorter one
  // is followed by silence.
  const tail = options.fit === 'video' ? ',apad' : '';
  if (options.mix === 'replace') return `[${sound}:a:0]anull${tail}[a]`;

  const level = (options.originalVolume / 100).toFixed(2);
  // The old sound runs the length of the video, so "longest" keeps it going
  // after a short song ends. normalize=0: amix otherwise halves both tracks to
  // make room for the pair.
  const duration = options.fit === 'video' ? 'longest' : 'shortest';
  return (
    `[${picture}:a:0]volume=${level}[old];` +
    `[${sound}:a:0][old]amix=inputs=2:duration=${duration}:normalize=0${tail}[a]`
  );
}

export function buildAudioReplaceArgs(
  options: AudioReplaceOptions,
  paths: { inputPaths: readonly string[]; outputPath: string },
  inputs: readonly (OperationInput | undefined)[],
): string[] {
  const { picture, sound } = replaceRoles(inputs.map((input) => input?.media.kind));
  const args: string[] = [];
  for (const path of paths.inputPaths) args.push('-i', path);

  const video = inputs[picture]?.info;
  // A silent video has nothing to mix in, and `[0:a:0]` would fail the graph.
  const mix = video?.hasAudio === false ? 'replace' : options.mix;
  const container = copyContainer(video);
  args.push(
    '-filter_complex',
    replaceFilter({ ...options, mix }, picture, sound),
    '-map',
    `${picture}:v:0`,
    '-map',
    '[a]',
    '-c:v',
    'copy',
    // WebM only takes Opus or Vorbis; everything else gets AAC, which plays anywhere.
    ...(container === 'webm'
      ? ['-c:a', 'libopus', '-b:a', '160k']
      : ['-c:a', 'aac', '-b:a', '192k']),
    '-shortest',
  );
  if (container === 'mp4') args.push('-movflags', '+faststart');
  args.push(paths.outputPath);
  return args;
}

function rolesOf(context: OperationContext): { picture: number; sound: number } {
  return replaceRoles(context.inputs?.map((input) => input.media.kind) ?? []);
}

function pictureInfo(context: OperationContext): MediaInfo | undefined {
  return context.inputs?.[rolesOf(context).picture]?.info;
}

function outputSeconds(
  options: AudioReplaceOptions,
  context: OperationContext,
): number | undefined {
  const { picture, sound } = rolesOf(context);
  const video = context.inputs?.[picture]?.info?.durationSeconds;
  if (options.fit === 'video') return video;
  const audio = context.inputs?.[sound]?.info?.durationSeconds;
  if (video === undefined || audio === undefined) return undefined;
  return Math.min(video, audio);
}

export const audioReplace = defineOperation<AudioReplaceOptions>({
  id: 'audio-replace',
  route: 'replace-audio',
  title: "Replace a video's sound",
  verb: 'Replace sound',
  summary: 'Put music or a new voice track under a video, or mix it in.',
  group: 'audio',
  accepts: ['video', 'audio'],
  inputs: { min: 2, max: 2 },
  requires: ['video'],
  defaults: DEFAULT_REPLACE,
  outputSuffix: 'new-sound',

  rejects: (context) => {
    const inputs = context.inputs ?? [];
    if (inputs.length < 2) return undefined;
    if (!inputs.some((input) => input.media.kind === 'video')) {
      return 'One of the two files needs to be a video, to give the picture.';
    }
    const { picture, sound } = rolesOf(context);
    if (inputs[picture]?.info?.hasVideo === false) return 'The video has no picture to keep.';
    if (inputs[sound]?.info?.hasAudio === false) {
      return `${inputs[sound].media.name} has no sound to use.`;
    }
    return undefined;
  },

  fields: [
    {
      kind: 'segmented',
      key: 'mix',
      label: 'The old sound',
      choices: [
        { value: 'replace', label: 'Remove it' },
        { value: 'mix', label: 'Keep it underneath' },
      ],
    },
    {
      kind: 'slider',
      key: 'originalVolume',
      label: 'Old sound level',
      min: 0,
      max: 100,
      step: 5,
      visibleWhen: (options) => options.mix === 'mix',
      display: (options) => `${options.originalVolume}%`,
      endLabels: ['Faint', 'As recorded'],
    },
    {
      kind: 'segmented',
      key: 'fit',
      label: 'Length',
      hint: 'A longer track is cut off at the end.',
      choices: [
        { value: 'video', label: 'As long as the video' },
        { value: 'shortest', label: 'Stop when either ends' },
      ],
    },
  ],

  preflight: (options, context) =>
    options.mix === 'mix' && pictureInfo(context)?.hasAudio === false
      ? ['The video has no sound of its own, so there is nothing to keep underneath.']
      : [],

  build: (options, paths, context) => {
    // Without a context (the registry's smoke test) there is one entry per path.
    const aligned = paths.inputPaths.map((_path, index) => context.inputs?.[index]);
    return buildAudioReplaceArgs(options, paths, aligned);
  },
  outputExtension: (_options, context) => copyContainer(pictureInfo(context)),
  outputMime: (_options, context) => CONTAINER_MIME[copyContainer(pictureInfo(context))],
  outputDuration: (options, context) => outputSeconds(options, context),

  estimateBytes: (options, context) => {
    const info = pictureInfo(context);
    const seconds = outputSeconds(options, context);
    if (seconds === undefined || info?.bitrate === undefined) return undefined;
    // The picture keeps its bitrate; the sound becomes 192 kbps.
    const videoBitrate = Math.max(info.bitrate - (info.hasAudio === false ? 0 : 128_000), 0);
    return Math.round(((videoBitrate + 192_000) / 8) * seconds);
  },
});
