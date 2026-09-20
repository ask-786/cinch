import { computed, inject, Injectable, signal } from '@angular/core';
import { isMobileDevice, preflightSize } from '../../media/file-system/limits';
import { toMediaFile, type MediaFile, type RejectedFile } from '../../media/models/media-file';
import { mergeInfo, type MediaInfo } from '../../media/models/media-info';
import { readNativeMetadata } from '../../media/probe/native-metadata';
import { Prober } from './prober';

/**
 * The files the user is currently working with. Held in one place so the route
 * that runs an operation can read what the landing page accepted.
 */
@Injectable({ providedIn: 'root' })
export class Selection {
  private readonly prober = inject(Prober);
  private readonly mobile = isMobileDevice();

  readonly files = signal<readonly MediaFile[]>([]);
  readonly rejected = signal<readonly RejectedFile[]>([]);
  /** id → metadata, filled in as each probe resolves. */
  readonly info = signal<ReadonlyMap<string, MediaInfo>>(new Map());
  /** id → size warning for files that were accepted but may struggle. */
  readonly warnings = signal<ReadonlyMap<string, string>>(new Map());

  readonly isEmpty = computed(() => this.files().length === 0);
  readonly count = computed(() => this.files().length);
  readonly totalBytes = computed(() => this.files().reduce((sum, f) => sum + f.size, 0));

  /** Everything the user dropped at once. Rejections replace the previous batch's. */
  add(incoming: readonly File[]): void {
    const accepted: MediaFile[] = [];
    const rejected: RejectedFile[] = [];
    const warnings = new Map(this.warnings());

    for (const file of incoming) {
      const media = toMediaFile(file);
      if (!media) {
        rejected.push({
          name: file.name,
          reason: 'Cinch does not handle this kind of file.',
        });
        continue;
      }

      if (media.size === 0) {
        rejected.push({ name: file.name, reason: 'This file is empty.' });
        continue;
      }

      const preflight = preflightSize(media.size, this.mobile);
      if (preflight.level === 'block') {
        rejected.push({ name: file.name, reason: preflight.message! });
        continue;
      }
      if (preflight.message) warnings.set(media.id, preflight.message);

      accepted.push(media);
    }

    this.rejected.set(rejected);
    this.warnings.set(warnings);
    if (accepted.length === 0) return;

    this.files.update((current) => [...current, ...accepted]);
    for (const media of accepted) void this.probe(media);
  }

  remove(id: string): void {
    this.files.update((current) => current.filter((f) => f.id !== id));
    this.info.update((current) => without(current, id));
    this.warnings.update((current) => without(current, id));
  }

  /** Reorders by id — used by the combine flows, where order is the content. */
  reorder(ids: readonly string[]): void {
    this.files.update((current) => {
      const byId = new Map(current.map((f) => [f.id, f]));
      const next = ids.map((id) => byId.get(id)).filter((f): f is MediaFile => f !== undefined);
      return next.length === current.length ? next : current;
    });
  }

  clear(): void {
    this.files.set([]);
    this.info.set(new Map());
    this.warnings.set(new Map());
    this.rejected.set([]);
  }

  dismissRejections(): void {
    this.rejected.set([]);
  }

  /**
   * Asks FFmpeg for the full picture. Called when the user shows interest in a
   * file rather than on drop, since it pulls the core down.
   */
  async deepProbe(id: string): Promise<void> {
    const media = this.files().find((f) => f.id === id);
    if (!media) return;
    if (this.info().get(id)?.source === 'ffprobe') return;

    const probed = await this.prober.probe(media);
    if (!probed) return;
    if (!this.files().some((f) => f.id === id)) return;

    this.info.update((current) => {
      const merged = mergeInfo(current.get(id), probed);
      return merged ? new Map(current).set(id, merged) : current;
    });
  }

  isProbing(id: string): boolean {
    return this.prober.probing().has(id);
  }

  private async probe(media: MediaFile): Promise<void> {
    const info = await readNativeMetadata(media);
    if (!info) return;
    // The file may have been removed while the decoder was working.
    if (!this.files().some((f) => f.id === media.id)) return;

    this.info.update((current) => new Map(current).set(media.id, info));
  }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
