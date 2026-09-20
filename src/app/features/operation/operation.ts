import { DecimalPipe, NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnInit,
  signal,
  untracked,
  type Type,
} from '@angular/core';
import { Router } from '@angular/router';
import { saveBlob } from '../../../media/file-system/save';
import { formatBytes, formatDuration } from '../../../media/humanize';
import {
  applyChange,
  initialOptions,
  outputNameFor,
  previewCommand,
  type OptionValue,
  type OptionValues,
} from '../../../media/operations/descriptor';
import { operationByRoute } from '../../../media/operations/registry';
import { JobList } from '../../components/job-list';
import { OperationForm } from '../../components/operation-form';
import { Button, Disclosure, Progress } from '../../components/ui';
import { JobQueue } from '../../core/job-queue';
import { Selection } from '../../core/selection';
import { CUSTOM_FORMS, type CustomFormInputs } from './custom-forms';

/**
 * One screen for every operation. It reads the descriptor named by the URL and
 * renders its form, its estimate, its command and its job — so Stage 6 is a
 * list of descriptor files rather than a list of screens.
 */
@Component({
  selector: 'app-operation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './operation.html',
  imports: [Button, DecimalPipe, Disclosure, JobList, NgComponentOutlet, OperationForm, Progress],
})
export class OperationScreen implements OnInit {
  private readonly router = inject(Router);
  protected readonly selection = inject(Selection);
  protected readonly queue = inject(JobQueue);

  /** Bound from the `:operation` path segment (withComponentInputBinding). */
  readonly operation = input<string>();

  protected readonly descriptor = computed(() => operationByRoute(this.operation()));

  /** Every selected file this operation could be pointed at. */
  protected readonly candidates = computed(() => {
    const descriptor = this.descriptor();
    if (!descriptor) return [];
    return this.selection.files().filter((file) => descriptor.accepts.includes(file.kind));
  });

  protected readonly chosenId = signal<string | undefined>(undefined);

  protected readonly media = computed(() => {
    const candidates = this.candidates();
    return candidates.find((file) => file.id === this.chosenId()) ?? candidates[0];
  });

  protected readonly info = computed(() => {
    const media = this.media();
    return media ? this.selection.info().get(media.id) : undefined;
  });

  protected readonly context = computed(() => ({ media: this.media(), info: this.info() }));

  protected readonly options = signal<OptionValues>({});
  /** Which operation the current options belong to, so a route change resets them. */
  private readonly optionsOwner = signal<string | undefined>(undefined);

  protected readonly jobId = signal<string | undefined>(undefined);
  protected readonly job = computed(() => this.queue.job(this.jobId()));
  protected readonly saveState = signal<'idle' | 'saved'>('idle');
  protected readonly copied = signal(false);

  protected readonly customForm = signal<Type<unknown> | undefined>(undefined);

  protected readonly rejection = computed(
    () => this.descriptor()?.rejects?.(this.context()) ?? undefined,
  );

  protected readonly warnings = computed(
    () => this.descriptor()?.preflight?.(this.options(), this.context()) ?? [],
  );

  protected readonly estimate = computed(() =>
    this.descriptor()?.estimateBytes?.(this.options(), this.context()),
  );

  protected readonly savedPercent = computed(() => {
    const media = this.media();
    const estimate = this.estimate();
    if (!media || estimate === undefined) return undefined;
    return Math.round((1 - estimate / media.size) * 100);
  });

  protected readonly resultSavedPercent = computed(() => {
    const media = this.media();
    const result = this.job()?.result;
    if (!media || !result) return undefined;
    return Math.round((1 - result.bytes / media.size) * 100);
  });

  protected readonly command = computed(() => {
    const descriptor = this.descriptor();
    if (!descriptor || !this.media()) return '';
    return previewCommand(descriptor, this.options(), this.context());
  });

  protected readonly outputName = computed(() => {
    const descriptor = this.descriptor();
    if (!descriptor) return 'output';
    return outputNameFor(descriptor, this.options(), this.context());
  });

  /** The runner's live state, but only while it is this screen's job running. */
  protected readonly state = computed(() => {
    const job = this.job();
    return job && job.status === 'running' ? this.queue.state() : undefined;
  });

  protected readonly eta = computed(() => {
    const state = this.state();
    if (!state || state.phase !== 'running' || !state.ratio || state.ratio < 0.02) return undefined;
    return (state.elapsedMs / state.ratio) * (1 - state.ratio);
  });

  protected readonly logTail = computed(() => this.queue.logs().slice(-40).join('\n'));

  protected readonly customInputs = computed<CustomFormInputs | undefined>(() => {
    const descriptor = this.descriptor();
    if (!descriptor) return undefined;
    return {
      operation: descriptor,
      options: this.options(),
      context: this.context(),
      onChange: (changes) => this.update(changes),
    };
  });

  constructor() {
    // Options are the operation's defaults put through its own `normalize`,
    // and re-normalized whenever the file or its metadata changes — trim's end
    // handle, for one, only knows where it belongs once the duration lands.
    effect(() => {
      const descriptor = this.descriptor();
      const context = this.context();
      if (!descriptor) return;

      untracked(() => {
        if (this.optionsOwner() === descriptor.id) {
          this.options.set(applyChange(descriptor, this.options(), {}, context));
          return;
        }
        this.optionsOwner.set(descriptor.id);
        this.options.set(initialOptions(descriptor, context));
      });
    });

    // The hand-written forms are lazy: nothing but trim pulls its component in.
    effect(() => {
      const key = this.descriptor()?.customForm;
      if (!key) {
        this.customForm.set(undefined);
        return;
      }
      void CUSTOM_FORMS[key]?.().then((component) => this.customForm.set(component));
    });

    // Opening an operation is intent: we need the real duration and codecs.
    effect(() => {
      const media = this.media();
      if (media) void this.selection.deepProbe(media.id);
    });
  }

  ngOnInit(): void {
    if (!this.descriptor() || this.candidates().length === 0) {
      void this.router.navigate(['/']);
    }
  }

  protected update(changes: Record<string, OptionValue>): void {
    const descriptor = this.descriptor();
    if (!descriptor) return;
    this.options.set(applyChange(descriptor, this.options(), changes, this.context()));
  }

  protected choose(id: string): void {
    this.chosenId.set(id);
    this.jobId.set(undefined);
    this.saveState.set('idle');
  }

  protected start(): void {
    const descriptor = this.descriptor();
    const media = this.media();
    if (!descriptor || !media) return;

    const options = this.options();
    const context = this.context();

    const id = this.queue.enqueue(
      {
        media,
        outputName: outputNameFor(descriptor, options, context),
        outputMime: descriptor.outputMime(options, context),
        // Captured by value: editing the form afterwards cannot change a job
        // that is already queued.
        build: (paths) => descriptor.build(options, paths, context),
        durationSeconds:
          descriptor.outputDuration?.(options, context) ?? context.info?.durationSeconds,
        sourceHeight: context.info?.height,
        estimatedOutputBytes: descriptor.estimateBytes?.(options, context),
      },
      `${descriptor.verb} · ${media.name}`,
    );

    this.jobId.set(id);
    this.saveState.set('idle');
  }

  protected async save(): Promise<void> {
    const job = this.job();
    if (!job?.result) return;
    const outcome = await saveBlob(job.result.blob, job.outputName);
    if (outcome !== 'cancelled') this.saveState.set('saved');
  }

  protected async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be refused; the command is on screen to select.
    }
  }

  protected again(): void {
    this.jobId.set(undefined);
    this.saveState.set('idle');
  }

  protected cancel(): void {
    const id = this.jobId();
    if (id) this.queue.cancel(id);
  }

  protected back(): void {
    void this.router.navigate(['/']);
  }

  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;

  protected abs(value: number): number {
    return Math.abs(value);
  }

  protected formatElapsed(ms: number): string {
    return formatDuration(Math.round(ms / 1000));
  }

  protected waitingAhead(): number {
    const jobs = this.queue.jobs();
    const index = jobs.findIndex((job) => job.id === this.jobId());
    return index <= 0
      ? 0
      : jobs.slice(0, index).filter((job) => job.status === 'waiting' || job.status === 'running')
          .length;
  }
}
