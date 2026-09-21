import type { MediaInfo } from '../models/media-info';
import { defineOperation, type Choice } from './descriptor';

/**
 * Change the container, and re-encode only if asked. Compression's sibling:
 * that one is about size, this one is about a file that plays where it has to.
 */

export type ContainerFormat = 'mp4' | 'webm' | 'mkv' | 'mov';
export type VideoTrack = 'copy' | 'h264' | 'h265' | 'vp9';
export type AudioTrack = 'copy' | 'aac' | 'opus' | 'none';

export type VideoConvertOptions = {
  readonly format: ContainerFormat;
  readonly video: VideoTrack;
  readonly audio: AudioTrack;
  /** 0–100, used when the video is re-encoded. */
  readonly quality: number;
};

export const DEFAULT_CONVERT: VideoConvertOptions = {
  format: 'mp4',
  video: 'copy',
  audio: 'copy',
  quality: 65,
};

/** Which video codecs each container will hold. */
const CONTAINER_VIDEO: Readonly<Record<ContainerFormat, readonly Exclude<VideoTrack, 'copy'>[]>> = {
  mp4: ['h264', 'h265'],
  mov: ['h264', 'h265'],
  mkv: ['h264', 'h265', 'vp9'],
  webm: ['vp9'],
};

const CONTAINER_AUDIO: Readonly<Record<ContainerFormat, readonly Exclude<AudioTrack, 'none'>[]>> = {
  mp4: ['copy', 'aac'],
  mov: ['copy', 'aac'],
  mkv: ['copy', 'aac', 'opus'],
  webm: ['opus'],
};

/** Names ffprobe uses for the codecs each container can carry untouched. */
const COPYABLE_VIDEO: Readonly<Record<ContainerFormat, readonly string[]>> = {
  mp4: ['h264', 'hevc', 'mpeg4', 'av1'],
  mov: ['h264', 'hevc', 'prores', 'mpeg4'],
  mkv: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'theora'],
  webm: ['vp8', 'vp9', 'av1'],
};

const COPYABLE_AUDIO: Readonly<Record<ContainerFormat, readonly string[]>> = {
  mp4: ['aac', 'mp3', 'alac'],
  mov: ['aac', 'mp3', 'alac', 'pcm_s16le'],
  mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3'],
  webm: ['opus', 'vorbis'],
};

export const CONTAINER_MIME: Readonly<Record<ContainerFormat, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
};

const CRF_RANGE: Readonly<Record<Exclude<VideoTrack, 'copy'>, readonly [number, number]>> = {
  h264: [34, 16],
  h265: [39, 21],
  vp9: [40, 22],
};

export function convertCrf(quality: number, codec: Exclude<VideoTrack, 'copy'>): number {
  const [worst, best] = CRF_RANGE[codec];
  const clamped = Math.min(100, Math.max(0, quality));
  return Math.round(worst - (clamped / 100) * (worst - best));
}

/** True when the stream can move into the container untouched. */
export function canCopyVideo(format: ContainerFormat, info: MediaInfo | undefined): boolean {
  const codec = info?.videoCodec;
  // Unknown codec: offer it anyway. FFmpeg refuses loudly and the error
  // taxonomy explains it, which beats hiding the fastest path on a guess.
  if (!codec) return true;
  return COPYABLE_VIDEO[format].includes(codec);
}

/**
 * Where a video stream can go without being re-encoded, for the operations
 * that only touch the sound. MP4 when it will take the codec, WebM for VP8/VP9
 * so a web clip stays a web clip, and Matroska, which holds anything, last.
 */
export function copyContainer(info: MediaInfo | undefined): ContainerFormat {
  const codec = info?.videoCodec;
  if (!codec || COPYABLE_VIDEO.mp4.includes(codec)) return 'mp4';
  if (COPYABLE_VIDEO.webm.includes(codec)) return 'webm';
  return 'mkv';
}

export function canCopyAudio(format: ContainerFormat, info: MediaInfo | undefined): boolean {
  const codec = info?.audioCodec;
  if (!codec) return true;
  return COPYABLE_AUDIO[format].includes(codec);
}

export function buildVideoConvertArgs(
  options: VideoConvertOptions,
  paths: { inputPath: string; outputPath: string },
): string[] {
  const args = ['-i', paths.inputPath];

  switch (options.video) {
    case 'copy':
      args.push('-c:v', 'copy');
      break;
    case 'h264':
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(convertCrf(options.quality, 'h264')),
        '-pix_fmt',
        'yuv420p',
      );
      break;
    case 'h265':
      args.push(
        '-c:v',
        'libx265',
        '-preset',
        'veryfast',
        '-crf',
        String(convertCrf(options.quality, 'h265')),
        '-tag:v',
        'hvc1',
        '-pix_fmt',
        'yuv420p',
      );
      break;
    case 'vp9':
      args.push(
        '-c:v',
        'libvpx-vp9',
        '-row-mt',
        '1',
        '-deadline',
        'realtime',
        '-crf',
        String(convertCrf(options.quality, 'vp9')),
        '-b:v',
        '0',
      );
      break;
  }

  switch (options.audio) {
    case 'copy':
      args.push('-c:a', 'copy');
      break;
    case 'aac':
      args.push('-c:a', 'aac', '-b:a', '160k');
      break;
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', '128k');
      break;
    case 'none':
      args.push('-an');
      break;
  }

  if (options.format === 'mp4' || options.format === 'mov') {
    args.push('-movflags', '+faststart');
  }

  args.push(paths.outputPath);
  return args;
}

function videoChoices(format: ContainerFormat, info: MediaInfo | undefined): readonly Choice[] {
  const copyable = canCopyVideo(format, info);
  const labels: Record<Exclude<VideoTrack, 'copy'>, string> = {
    h264: 'H.264',
    h265: 'H.265',
    vp9: 'VP9',
  };
  return [
    {
      value: 'copy',
      label: 'Leave the picture alone',
      note: copyable ? 'fastest' : 'not possible in this container',
      disabled: !copyable,
    },
    ...CONTAINER_VIDEO[format].map((codec) => ({
      value: codec,
      label: `Re-encode as ${labels[codec]}`,
    })),
  ];
}

function audioChoices(format: ContainerFormat, info: MediaInfo | undefined): readonly Choice[] {
  const allowed = CONTAINER_AUDIO[format];
  const copyable = allowed.includes('copy') && canCopyAudio(format, info);
  const labels: Record<Exclude<AudioTrack, 'none' | 'copy'>, string> = {
    aac: 'Re-encode as AAC',
    opus: 'Re-encode as Opus',
  };
  return [
    {
      value: 'copy',
      label: 'Leave the sound alone',
      note: copyable ? 'fastest' : 'not possible in this container',
      disabled: !copyable,
    },
    ...allowed
      .filter((track): track is 'aac' | 'opus' => track !== 'copy')
      .map((track) => ({ value: track, label: labels[track] })),
    { value: 'none', label: 'Remove the audio' },
  ];
}

export const videoConvert = defineOperation<VideoConvertOptions>({
  id: 'video-convert',
  route: 'convert',
  title: 'Convert video',
  verb: 'Convert',
  summary: 'Change the container — and only re-encode if you have to.',
  group: 'video',
  accepts: ['video'],
  defaults: DEFAULT_CONVERT,
  outputSuffix: 'converted',

  fields: [
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      choices: [
        { value: 'mp4', label: 'MP4', note: 'plays everywhere' },
        { value: 'webm', label: 'WebM', note: 'web only' },
        { value: 'mkv', label: 'MKV', note: 'anything goes' },
        { value: 'mov', label: 'MOV', note: 'QuickTime' },
      ],
    },
    {
      kind: 'select',
      key: 'video',
      label: 'Picture',
      hint: 'Leaving it alone is instant — the stream is copied across, not re-encoded.',
      choices: (options, context) => videoChoices(options.format, context.info),
    },
    {
      kind: 'select',
      key: 'audio',
      label: 'Sound',
      choices: (options, context) => audioChoices(options.format, context.info),
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      min: 10,
      max: 95,
      visibleWhen: (options) => options.video !== 'copy',
      display: (options) =>
        options.video === 'copy'
          ? ''
          : `${options.quality} · CRF ${convertCrf(options.quality, options.video)}`,
      endLabels: ['Smaller file', 'Better picture'],
    },
  ],

  normalize: (options, context) => {
    const format = options.format;

    let video = options.video;
    if (
      video === 'copy'
        ? !canCopyVideo(format, context.info)
        : !CONTAINER_VIDEO[format].includes(video)
    ) {
      video = CONTAINER_VIDEO[format][0];
    }

    let audio = options.audio;
    const audioAllowed = CONTAINER_AUDIO[format];
    if (
      audio === 'copy'
        ? !canCopyAudio(format, context.info)
        : audio !== 'none' && !audioAllowed.includes(audio)
    ) {
      audio = audioAllowed.find((track) => track !== 'copy') ?? 'none';
    }

    return { ...options, video, audio };
  },

  preflight: (options, context) => {
    const warnings: string[] = [];
    if (options.video === 'copy' && options.audio === 'copy') {
      warnings.push(
        'Both streams are being copied, so this only rewraps the file. It will take seconds and the picture will be identical.',
      );
    }
    if (options.video === 'h265' && options.format === 'mkv') {
      warnings.push('H.265 in MKV plays in VLC and little else. MP4 is the safer home for it.');
    }
    if (context.info?.hasAudio === false && options.audio !== 'none') {
      warnings.push('This file has no audio track, so the sound setting will not change anything.');
    }
    return warnings;
  },

  build: (options, paths) => buildVideoConvertArgs(options, paths),
  outputExtension: (options) => options.format,
  outputMime: (options) => CONTAINER_MIME[options.format],

  estimateBytes: (options, context) => {
    // Copying both streams means the output is the input, give or take a
    // container header. Anything else is a guess we decline to make.
    if (options.video === 'copy' && options.audio === 'copy') return context.media?.size;
    return undefined;
  },
});
