import { classify, extensionOf, type MediaKind } from './media-kind';

/** A file the user picked, plus what we could tell about it without reading it. */
export interface MediaFile {
  readonly id: string;
  readonly file: File;
  readonly name: string;
  readonly size: number;
  readonly extension: string;
  readonly kind: MediaKind;
}

export interface RejectedFile {
  readonly name: string;
  readonly reason: string;
}

let counter = 0;

/** Returns undefined when the file is not a media type we handle. */
export function toMediaFile(file: File): MediaFile | undefined {
  const kind = classify(file.name, file.type);
  if (!kind) return undefined;

  return {
    id: `f${++counter}`,
    file,
    name: file.name,
    size: file.size,
    extension: extensionOf(file.name),
    kind,
  };
}
