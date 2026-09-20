import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';

const TIMEOUT_MS = 5000;

/**
 * Duration and dimensions from the browser's own decoders — instant, no WASM
 * download, no worker. Everything else waits for ffprobe (Stage 3).
 *
 * Resolves to undefined when the browser cannot decode the file, which is
 * common and not an error: FFmpeg may still handle it.
 */
export async function readNativeMetadata(media: MediaFile): Promise<MediaInfo | undefined> {
  const url = URL.createObjectURL(media.file);
  try {
    switch (media.kind) {
      case 'video':
        return await fromMediaElement(document.createElement('video'), url, media);
      case 'audio':
        return await fromMediaElement(document.createElement('audio'), url, media);
      case 'image':
        return await fromImage(url, media);
      case 'subtitle':
        return undefined;
    }
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromMediaElement(
  element: HTMLVideoElement | HTMLAudioElement,
  url: string,
  media: MediaFile,
): Promise<MediaInfo | undefined> {
  element.preload = 'metadata';
  element.muted = true;

  /** Read while the element still holds the file — releasing it resets duration to NaN. */
  const snapshot = (): Snapshot => {
    const video = element instanceof HTMLVideoElement ? element : undefined;
    return {
      duration: element.duration,
      width: video?.videoWidth || undefined,
      height: video?.videoHeight || undefined,
    };
  };

  const loaded = await new Promise<Snapshot | undefined>((resolve) => {
    const settle = (result: Snapshot | undefined) => {
      clearTimeout(timer);
      element.removeEventListener('loadedmetadata', onLoad);
      element.removeEventListener('error', onError);
      element.removeAttribute('src');
      element.load();
      resolve(result);
    };
    const onLoad = () => settle(snapshot());
    const onError = () => settle(undefined);
    const timer = setTimeout(() => settle(undefined), TIMEOUT_MS);

    element.addEventListener('loadedmetadata', onLoad, { once: true });
    element.addEventListener('error', onError, { once: true });
    element.src = url;
  });

  if (!loaded) return undefined;

  return {
    source: 'native',
    kind: media.kind,
    // Streamed WebM and some MP3s report Infinity until fully decoded.
    durationSeconds: Number.isFinite(loaded.duration) ? loaded.duration : undefined,
    width: loaded.width,
    height: loaded.height,
    hasVideo: media.kind === 'video' ? loaded.width !== undefined : false,
    hasAudio: media.kind === 'audio' ? true : undefined,
  };
}

interface Snapshot {
  readonly duration: number;
  readonly width?: number;
  readonly height?: number;
}

async function fromImage(url: string, media: MediaFile): Promise<MediaInfo | undefined> {
  const image = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    image.src = url;
  });

  if (!loaded) return undefined;

  return {
    source: 'native',
    kind: media.kind,
    width: image.naturalWidth || undefined,
    height: image.naturalHeight || undefined,
    hasVideo: false,
    hasAudio: false,
  };
}
