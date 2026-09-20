import { computed, inject, Injectable, signal } from '@angular/core';
import type { Explanation } from '../../media/ffmpeg/errors';
import { JobRunner, type JobResult, type JobSpec } from './job-runner';

export type QueuedStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QueuedJob {
  readonly id: string;
  /** "Compress · holiday.mp4" — what the list shows. */
  readonly label: string;
  readonly outputName: string;
  readonly inputBytes: number;
  readonly spec: JobSpec;
  readonly status: QueuedStatus;
  readonly result?: JobResult;
  readonly failure?: Explanation;
}

let counter = 0;

/**
 * One job runs at a time — FFmpeg's `exec` is synchronous inside its worker,
 * so a second one could only ever queue behind the first (D7). This makes that
 * queue explicit: set up the next job while the current one encodes, and the
 * results stay in a list you can save from.
 */
@Injectable({ providedIn: 'root' })
export class JobQueue {
  private readonly runner = inject(JobRunner);

  readonly jobs = signal<readonly QueuedJob[]>([]);
  /** The job the runner's signals are currently describing. */
  readonly activeId = signal<string | undefined>(undefined);

  readonly state = this.runner.state;
  readonly logs = this.runner.logs;

  readonly waiting = computed(() => this.jobs().filter((job) => job.status === 'waiting'));
  readonly finished = computed(() =>
    this.jobs().filter((job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'),
  );
  readonly isBusy = computed(() => this.activeId() !== undefined);

  enqueue(spec: JobSpec, label: string): string {
    const id = `j${++counter}`;
    this.jobs.update((current) => [
      ...current,
      {
        id,
        label,
        outputName: spec.outputName,
        inputBytes: spec.media.size,
        spec,
        status: 'waiting',
      },
    ]);
    void this.pump();
    return id;
  }

  job(id: string | undefined): QueuedJob | undefined {
    return id === undefined ? undefined : this.jobs().find((job) => job.id === id);
  }

  /** Cancels the running job, or drops a waiting one before it starts. */
  cancel(id: string): void {
    const job = this.job(id);
    if (!job) return;

    if (job.status === 'running') {
      this.runner.cancel();
      return;
    }
    if (job.status === 'waiting') this.patch(id, { status: 'cancelled' });
  }

  remove(id: string): void {
    if (this.job(id)?.status === 'running') this.runner.cancel();
    this.jobs.update((current) => current.filter((job) => job.id !== id));
  }

  clearFinished(): void {
    this.jobs.update((current) =>
      current.filter((job) => job.status === 'waiting' || job.status === 'running'),
    );
  }

  /** Runs the next waiting job, if nothing else is running. */
  private async pump(): Promise<void> {
    if (this.activeId() !== undefined) return;

    const next = this.jobs().find((job) => job.status === 'waiting');
    if (!next) return;

    this.activeId.set(next.id);
    this.patch(next.id, { status: 'running' });

    const result = await this.runner.run(next.spec);
    const state = this.runner.state();

    if (result) {
      this.patch(next.id, { status: 'done', result });
    } else if (state.phase === 'cancelled') {
      this.patch(next.id, { status: 'cancelled' });
    } else {
      this.patch(next.id, { status: 'failed', failure: state.failure });
    }

    this.activeId.set(undefined);
    void this.pump();
  }

  private patch(id: string, changes: Partial<QueuedJob>): void {
    this.jobs.update((current) =>
      current.map((job) => (job.id === id ? { ...job, ...changes } : job)),
    );
  }
}
