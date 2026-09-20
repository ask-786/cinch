import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  formatBytes,
  formatDimensions,
  formatDuration,
  resolutionLabel,
} from '../../media/humanize';
import type { MediaFile } from '../../media/models/media-file';
import type { MediaInfo } from '../../media/models/media-info';
import { KIND_LABELS } from '../../media/models/media-kind';
import { Disclosure } from './ui';

/** The file, as far as we can describe it before FFmpeg has been anywhere near it. */
@Component({
  selector: 'app-media-info-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Disclosure],
  template: `
    <div class="rounded-card border border-line bg-surface p-4">
      <div class="flex items-start gap-3">
        <div
          class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-muted"
          [attr.aria-hidden]="true"
        >
          <svg class="size-[1.125rem]" viewBox="0 0 20 20" fill="none">
            @switch (media().kind) {
              @case ('video') {
                <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" stroke-width="1.5" />
                <path d="m8.5 8 4 2-4 2V8Z" fill="currentColor" />
              }
              @case ('audio') {
                <path d="M7.5 12.5V4.5l7-1.5v8" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                <circle cx="5.75" cy="13.5" r="2.25" stroke="currentColor" stroke-width="1.5" />
                <circle cx="12.75" cy="12" r="2.25" stroke="currentColor" stroke-width="1.5" />
              }
              @case ('image') {
                <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" stroke-width="1.5" />
                <circle cx="7" cy="8" r="1.25" fill="currentColor" />
                <path d="m3.5 14 4-4 3.5 3.5 2.5-2 3 2.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              }
              @default {
                <rect x="3.5" y="3" width="13" height="14" rx="2" stroke="currentColor" stroke-width="1.5" />
                <path d="M6.5 8.5h7M6.5 11.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              }
            }
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-ink" [title]="media().name">
            {{ media().name }}
          </p>
          <p class="mt-0.5 text-sm text-muted">
            @for (fact of facts(); track fact; let last = $last) {
              <span>{{ fact }}</span>
              @if (!last) {
                <span class="px-1.5 text-faint">·</span>
              }
            }
          </p>
        </div>

        <button
          type="button"
          (click)="removed.emit()"
          [attr.aria-label]="'Remove ' + media().name"
          class="-m-1.5 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      @if (warning(); as text) {
        <p class="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-ink">
          {{ text }}
        </p>
      }

      <div class="mt-3 border-t border-line pt-2">
        <app-disclosure summary="Details" (toggled)="$event && detailsOpened.emit()">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
            @for (row of details(); track row[0]) {
              <dt class="text-muted">{{ row[0] }}</dt>
              <dd class="font-mono text-ink">{{ row[1] }}</dd>
            }
          </dl>
          @if (probing()) {
            <p class="mt-2 flex items-center gap-2 text-xs text-faint">
              <span
                class="inline-block size-3 animate-spin rounded-full border-2 border-line border-t-accent"
                aria-hidden="true"
              ></span>
              Reading the file with FFmpeg…
            </p>
          } @else if (info()?.source !== 'ffprobe') {
            <p class="mt-2 text-xs text-faint">
              These come from the browser's own decoder. FFmpeg can say more — it needs to
              download once, about 32 MB.
            </p>
          }
        </app-disclosure>
      </div>
    </div>
  `,
})
export class MediaInfoPanel {
  readonly media = input.required<MediaFile>();
  readonly info = input<MediaInfo | undefined>(undefined);
  readonly warning = input<string | undefined>(undefined);
  readonly probing = input(false);

  readonly removed = output<void>();
  /** Fired when the user opens Details, which is when a deep probe is worth it. */
  readonly detailsOpened = output<void>();

  /** The one-line summary: type, size, and whatever the decoder could tell us. */
  protected readonly facts = computed(() => {
    const media = this.media();
    const info = this.info();
    const facts: string[] = [KIND_LABELS[media.kind], formatBytes(media.size)];

    if (info?.durationSeconds !== undefined) facts.push(formatDuration(info.durationSeconds));

    // A still is described by its pixel size; a video by the name people use for it.
    if (media.kind === 'image') {
      if (info?.width && info.height) facts.push(formatDimensions(info.width, info.height));
    } else {
      const resolution = resolutionLabel(info?.width, info?.height);
      if (resolution) facts.push(resolution);
    }

    return facts;
  });

  protected readonly details = computed<readonly (readonly [string, string])[]>(() => {
    const media = this.media();
    const info = this.info();
    const rows: (readonly [string, string])[] = [
      ['File', media.name],
      ['Size', `${formatBytes(media.size)} (${media.size.toLocaleString()} bytes)`],
      ['Type', media.file.type || `.${media.extension}`],
    ];

    if (info?.durationSeconds !== undefined) {
      rows.push(['Duration', formatDuration(info.durationSeconds)]);
    }
    if (info?.width && info.height) {
      rows.push(['Dimensions', formatDimensions(info.width, info.height)]);
    }
    if (info?.frameRate) rows.push(['Frame rate', `${info.frameRate} fps`]);
    if (info?.videoCodec) rows.push(['Video codec', info.videoCodec]);
    if (info?.audioCodec) {
      const channels = info.channels === 1 ? 'mono' : info.channels === 2 ? 'stereo' : undefined;
      const sample = info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : undefined;
      const extra = [sample, channels].filter(Boolean).join(', ');
      rows.push(['Audio codec', extra ? `${info.audioCodec} (${extra})` : info.audioCodec]);
    }
    if (info?.bitrate) rows.push(['Bitrate', `${Math.round(info.bitrate / 1000)} kbps`]);
    if (info?.container) rows.push(['Container', info.container]);

    return rows;
  });
}
