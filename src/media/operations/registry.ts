import type { MediaKind } from '../models/media-kind';
import { audioExtract } from './audio-extract';
import type { Operation, OperationGroup } from './descriptor';
import { videoCompress } from './video-compress';
import { videoConvert } from './video-convert';
import { videoTrim } from './video-trim';

/**
 * Every operation Cinch can do. The routes, the home screen's menu and the
 * generated forms all read from here — adding an entry to this array is the
 * whole of "adding an operation".
 */
export const OPERATIONS: readonly Operation[] = [
  videoCompress,
  videoConvert,
  videoTrim,
  audioExtract,
];

export function operationByRoute(route: string | null | undefined): Operation | undefined {
  if (!route) return undefined;
  return OPERATIONS.find((operation) => operation.route === route);
}

export function operationById(id: string): Operation | undefined {
  return OPERATIONS.find((operation) => operation.id === id);
}

/** The operations that could be run on at least one of the selected files. */
export function operationsFor(kinds: readonly MediaKind[]): readonly Operation[] {
  return OPERATIONS.filter((operation) =>
    operation.accepts.some((accepted) => kinds.includes(accepted)),
  );
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
