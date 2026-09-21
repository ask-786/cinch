import type { MediaKind } from '../models/media-kind';
import { audioExtract } from './audio-extract';
import { audioMerge } from './audio-merge';
import { audioRemove } from './audio-remove';
import { audioReplace } from './audio-replace';
import { imagesVideo } from './images-video';
import { canRun, type Operation, type OperationGroup } from './descriptor';
import { videoCompress } from './video-compress';
import { videoConvert } from './video-convert';
import { videoFps } from './video-fps';
import { videoFrames } from './video-frames';
import { videoJoin } from './video-join';
import { videoResize } from './video-resize';
import { videoRotate } from './video-rotate';
import { videoScenes } from './video-scenes';
import { videoSegments } from './video-segments';
import { videoSpeed } from './video-speed';
import { videoStack } from './video-stack';
import { videoThumbnails } from './video-thumbnails';
import { videoTrim } from './video-trim';
import { videoWatermark } from './video-watermark';

/**
 * Every operation Cinch can do. The routes, the home screen's menu and the
 * generated forms all read from here — adding an entry to this array is the
 * whole of "adding an operation".
 */
export const OPERATIONS: readonly Operation[] = [
  videoCompress,
  videoConvert,
  videoResize,
  videoRotate,
  videoSpeed,
  videoFps,
  videoTrim,
  videoSegments,
  videoJoin,
  videoStack,
  videoWatermark,
  audioExtract,
  audioMerge,
  audioReplace,
  audioRemove,
  videoFrames,
  videoThumbnails,
  videoScenes,
  imagesVideo,
];

export function operationByRoute(route: string | null | undefined): Operation | undefined {
  if (!route) return undefined;
  return OPERATIONS.find((operation) => operation.route === route);
}

export function operationById(id: string): Operation | undefined {
  return OPERATIONS.find((operation) => operation.id === id);
}

/**
 * The operations the selection is enough for. Pass one kind per selected file,
 * duplicates included: joining needs two videos, not just the idea of one.
 */
export function operationsFor(kinds: readonly MediaKind[]): readonly Operation[] {
  return OPERATIONS.filter((operation) => canRun(operation, kinds));
}

export const GROUP_LABELS: Readonly<Record<OperationGroup, string>> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Images & GIF',
  subtitle: 'Subtitles',
};

/** Operations bucketed by group, in registry order, skipping empty groups. */
export function groupOperations(
  operations: readonly Operation[],
): readonly { group: OperationGroup; label: string; operations: readonly Operation[] }[] {
  const groups: OperationGroup[] = ['video', 'audio', 'image', 'subtitle'];
  return groups
    .map((group) => ({
      group,
      label: GROUP_LABELS[group],
      operations: operations.filter((operation) => operation.group === group),
    }))
    .filter((bucket) => bucket.operations.length > 0);
}
