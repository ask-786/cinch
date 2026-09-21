import { zipBlobs, type ZipEntry } from './zip';

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

/**
 * Writes the result to disk. Where the browser allows it the bytes are
 * streamed straight into the file the user picked, so a large output is never
 * copied a second time; everywhere else it falls back to a download (D15).
 */
export async function saveBlob(blob: Blob, suggestedName: string): Promise<SaveOutcome> {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName,
        types: [
          {
            description: 'Media file',
            accept: { [blob.type || 'application/octet-stream']: [extensionOf(suggestedName)] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await blob.stream().pipeTo(writable);
      return 'saved';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // Anything else — a cross-origin-isolated quirk, a locked file — falls
      // back rather than losing the result the user just waited for.
    }
  }

  download(blob, suggestedName);
  return 'downloaded';
}

/**
 * Writes a numbered run of files — frames, segments. Where the browser can
 * write into a folder the user picks, each file lands there as itself;
 * everywhere else they arrive as one zip, since a page that starts forty
 * downloads at once gets all but the first blocked.
 */
export async function saveFiles(
  files: readonly ZipEntry[],
  archiveName: string,
): Promise<SaveOutcome> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options: unknown) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  if (picker) {
    try {
      const folder = await picker.call(window, { mode: 'readwrite' });
      for (const file of files) {
        const handle = await folder.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await file.blob.stream().pipeTo(writable);
      }
      return 'saved';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // Same reasoning as a single file: fall back rather than lose the work.
    }
  }

  download(await zipBlobs(files), archiveName);
  return 'downloaded';
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before dropping the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** `holiday.mov` + `mp4` → `holiday-compressed.mp4`. */
export function outputFileName(inputName: string, suffix: string, extension: string): string {
  const dot = inputName.lastIndexOf('.');
  const stem = dot > 0 ? inputName.slice(0, dot) : inputName;
  return `${stem}-${suffix}.${extension}`;
}
