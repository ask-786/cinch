import { inject, Injectable, signal } from '@angular/core';
import { chooseCore } from '../../media/ffmpeg/core-routing';
import { ffprobeArgs, parseFfprobe } from '../../media/ffmpeg/ffprobe';
import type { MediaFile } from '../../media/models/media-file';
import type { MediaInfo } from '../../media/models/media-info';
import { FfmpegClient } from './ffmpeg-client';

/** The probe writes a few kilobytes of JSON, so it is never the big job. */
const PROBE_OUTPUT_BYTES = 64 * 1024;

/**
 * Runs ffprobe on a file and hands back the parsed result. Kicked off on
 * intent rather than on drop, because it costs a 32 MB core download (D5).
 */
@Injectable({ providedIn: 'root' })
export class Prober {
  private readonly client = inject(FfmpegClient);
  private readonly inFlight = new Map<string, Promise<MediaInfo | undefined>>();

  readonly probing = signal<ReadonlySet<string>>(new Set());

  probe(media: MediaFile): Promise<MediaInfo | undefined> {
    const existing = this.inFlight.get(media.id);
    if (existing) return existing;

    const run = this.run(media).finally(() => {
      this.inFlight.delete(media.id);
      this.probing.update((current) => {
        const next = new Set(current);
        next.delete(media.id);
        return next;
      });
    });

    this.inFlight.set(media.id, run);
    this.probing.update((current) => new Set(current).add(media.id));
    return run;
  }

  private async run(media: MediaFile): Promise<MediaInfo | undefined> {
    // Reuse whichever core is already warm; a probe is too small to justify a swap.
    const variant =
      this.client.loadedVariant() ??
      chooseCore(
        { estimatedOutputBytes: PROBE_OUTPUT_BYTES, sourceHeight: undefined },
        this.client.capabilities,
      );

    await this.client.ensureLoaded(variant);

    const input = await this.client.mountInput(media.file);
    const outputPath = `/probe-${media.id}.json`;

    try {
      await this.client.ffprobe(ffprobeArgs(input.path, outputPath));
      const json = await this.client.readText(outputPath);
      return parseFfprobe(json, media.kind);
    } catch {
      // A file FFmpeg cannot read is not an error worth interrupting anyone for.
      return undefined;
    } finally {
      await this.client.deleteFile(outputPath);
      await this.client.unmount(input);
    }
  }
}
