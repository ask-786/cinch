import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { RejectedFile } from '../../media/models/media-file';

/**
 * The files a drop could not use. Shown wherever a file can be dropped — the
 * home screen and any operation screen that is still asking for one.
 */
@Component({
  selector: 'app-rejected-files',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Out of the layout entirely when there is nothing to report, so a caller's
  // `space-y` or margin does not leave a gap where the empty host sits.
  host: { '[style.display]': "files().length > 0 ? 'block' : 'none'" },
  template: `
    <div class="rounded-card border border-line bg-danger-soft p-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-ink">{{ heading() }}</p>
          <ul class="mt-2 space-y-1.5 text-sm text-muted">
            @for (item of files(); track item.name) {
              <li>
                <span class="font-medium text-ink">{{ item.name }}</span>
                <span class="px-1 text-faint">—</span>{{ item.reason }}
              </li>
            }
          </ul>
        </div>
        @if (dismissable()) {
          <button
            type="button"
            (click)="dismissed.emit()"
            aria-label="Dismiss"
            class="-m-1.5 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:text-ink"
          >
            <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        }
      </div>
    </div>
  `,
})
export class RejectedFiles {
  readonly files = input.required<readonly RejectedFile[]>();
  readonly dismissable = input(true);

  readonly dismissed = output<void>();

  protected readonly heading = computed(() =>
    this.files().length === 1 ? 'One file was skipped' : 'Some files were skipped',
  );
}
