import { defineOperation } from './descriptor';
import { CONTAINER_MIME, copyContainer } from './video-convert';

/**
 * Keep the picture and throw the sound away.
 *
 * The picture is copied as it is, so this takes seconds and costs nothing in
 * quality. That is also why the container can change: an MP4 stays an MP4,
 * but a stream MP4 cannot hold has to land somewhere that will take it.
 */

export type AudioRemoveOptions = Record<string, never>;

export function buildAudioRemoveArgs(paths: { inputPath: string; outputPath: string }): string[] {
  return ['-i', paths.inputPath, '-map', '0:v:0', '-c:v', 'copy', '-an', paths.outputPath];
}

export const audioRemove = defineOperation<AudioRemoveOptions>({
  id: 'audio-remove',
  route: 'mute',
  title: 'Remove the sound',
  verb: 'Remove sound',
  summary: 'Keep the picture and drop the sound track, without re-encoding.',
  group: 'audio',
  accepts: ['video'],
  defaults: {},
  fields: [],
  outputSuffix: 'silent',

  rejects: (context) => {
    if (context.info?.hasVideo === false) return 'This file has no picture to keep.';
    if (context.info?.hasAudio === false) return 'This video is already silent.';
    return undefined;
  },

  build: (_options, paths) => buildAudioRemoveArgs(paths),
  outputExtension: (_options, context) => copyContainer(context.info),
  outputMime: (_options, context) => CONTAINER_MIME[copyContainer(context.info)],

  estimateBytes: (_options, context) => {
    const info = context.info;
    if (info?.durationSeconds === undefined || info.bitrate === undefined) return undefined;
    // The sound is a small share of most videos; assume a typical 128 kbps of it.
    const videoBitrate = Math.max(info.bitrate - (info.hasAudio === false ? 0 : 128_000), 0);
    return Math.round((videoBitrate / 8) * info.durationSeconds);
  },
});
