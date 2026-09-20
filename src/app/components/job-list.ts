import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { saveBlob } from '../../media/file-system/save';
import { formatBytes } from '../../media/humanize';
import { JobQueue, type QueuedJob } from '../core/job-queue';
import { Button } from './ui';

const STATUS_LABELS: Readonly<Record<QueuedJob['status'], string>> = {
  waiting: 'Waiting',
  running: 'Working',
  done: 'Ready',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const STATUS_CLASSES: Readonly<Record<QueuedJob['status'], string>> = {
  waiting: 'text-muted',
  running: 'text-accent',
  done: 'text-good',
  failed: 'text-danger',
  cancelled: 'text-muted',
};

/**
 * The queue, as a list. One job runs at a time (D7), so this is mostly about
 * the ones that finished: results live here until the tab closes.
 */
@Component({
  selector: 'app-job-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    @if (visible().length > 0) {
      <section class="rounded-card border border-line bg-surface p-5">
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-sm font-semibold text-ink">{{ heading() }}</h2>
          @if (queue.finished().length > 0) {
            <button
              appButton
              variant="ghost"
              size="sm"
              type="button"
              (click)="queue.clearFinished()"
            >
              Clear finished
            </button>
          }
        </div>

        <ul class="mt-3 divide-y divide-line">
          @for (job of visible(); track job.id) {
            <li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ job.label }}</span>

              <span class="text-xs font-medium" [class]="statusClass(job)">
                {{ statusLabel(job) }}
              </span>

              @if (job.result; as result) {
                <span class="font-mono text-xs text-muted">{{ bytes(result.bytes) }}</span>
                <button appButton variant="secondary" size="sm" type="button" (click)="save(job)">
                  {{ saved().has(job.id) ? 'Saved' : 'Save' }}
                </button>
              } @else if (job.status === 'waiting' || job.status === 'running') {
                <button
                  appButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  (click)="queue.cancel(job.id)"
                >
                  Stop
                </button>
              } @else {
                <button
                  appButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  (click)="queue.remove(job.id)"
                >
                  Remove
                </button>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class JobList {
  protected readonly queue = inject(JobQueue);

  /** Hides one job — the screen that started it is already showing it. */
  readonly excludeId = input<string | undefined>(undefined);
  readonly heading = input('Jobs');

  protected readonly saved = signal<ReadonlySet<string>>(new Set());

  protected readonly visible = computed(() =>
    this.queue.jobs().filter((job) => job.id !== this.excludeId()),
  );

  protected statusLabel(job: QueuedJob): string {
    return STATUS_LABELS[job.status];
  }

  protected statusClass(job: QueuedJob): string {
    return STATUS_CLASSES[job.status];
  }

  protected bytes(value: number): string {
    return formatBytes(value);
  }

  protected async save(job: QueuedJob): Promise<void> {
    if (!job.result) return;
    const outcome = await saveBlob(job.result.blob, job.outputName);
    if (outcome === 'cancelled') return;
    this.saved.update((current) => new Set(current).add(job.id));
  }
}
