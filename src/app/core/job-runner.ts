import { computed, inject, Injectable, signal } from '@angular/core';
import { chooseCore, explainCoreChoice, type CoreVariant } from '../../media/ffmpeg/core-routing';
import { explainFailure, type Explanation } from '../../media/ffmpeg/errors';
import { ProgressTracker } from '../../media/ffmpeg/progress';
import { threadArgs } from '../../media/ffmpeg/threads';
import type { MediaFile } from '../../media/models/media-file';
import { FfmpegClient } from './ffmpeg-client';

export interface JobPaths {
  readonly inputPath: string;
  readonly outputPath: string;
}

export interface JobSpec {
  readonly media: MediaFile;
  /** File name offered when saving, e.g. `holiday-compressed.mp4`. */
  readonly outputName: string;
  readonly outputMime: string;
  /** Pure: the same paths always produce the same command. */
  readonly build: (paths: JobPaths) => string[];
  readonly durationSeconds?: number;
  readonly sourceHeight?: number;
  readonly estimatedOutputBytes?: number;
}

export type JobPhase = 'idle' | 'loading' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobState {
  readonly phase: JobPhase;
  /** 0–1 while running, undefined when FFmpeg is not saying anything useful. */
  readonly ratio?: number;
  readonly elapsedMs: number;
  readonly variant?: CoreVariant;
  readonly coreNote?: string;
  /** Why it failed, in the user's words (D17). Set only in the error phase. */
  readonly failure?: Explanation;
}

export interface JobResult {
  readonly blob: Blob;
  readonly bytes: number;
  readonly elapsedMs: number;
  /** What actually ran, including the thread count the core needed. */
  readonly args: readonly string[];
  readonly variant: CoreVariant;
}

const IDLE: JobState = { phase: 'idle', elapsedMs: 0 };

/**
 * Runs one job at a time and keeps the UI's view of it in signals.
 *
 * Cancelling means terminating the worker: FFmpeg's WASM cannot be interrupted
 * and an AbortSignal would only reject our promise while the work carried on
 * (D14). The filesystem goes with it, which is why every job mounts its own
 * input and writes its own output.
 */
@Injectable({ providedIn: 'root' })
export class JobRunner {
  private readonly client = inject(FfmpegClient);

  readonly state = signal<JobState>(IDLE);
  readonly result = signal<JobResult | undefined>(undefined);
  readonly logs = this.client.logs;

  readonly isBusy = computed(() => {
    const phase = this.state().phase;
    return phase === 'loading' || phase === 'running';
  });

  private cancelled = false;
  private ticker?: ReturnType<typeof setInterval>;

  async run(spec: JobSpec): Promise<JobResult | undefined> {
    if (this.isBusy()) return undefined;

    this.cancelled = false;
    this.result.set(undefined);
    // A fresh run starts from IDLE so no failure or ratio survives into it.
    this.state.set({ ...IDLE, phase: 'loading' });
    this.client.clearLogs();

    const startedAt = performance.now();
    this.startTicker(startedAt);

    const requested = chooseCore(
      { estimatedOutputBytes: spec.estimatedOutputBytes, sourceHeight: spec.sourceHeight },
      this.client.capabilities,
    );

    try {
      const result = await this.attempt(spec, requested, startedAt);
      if (result) {
        this.result.set(result);
        this.patch({ phase: 'done', ratio: 1, elapsedMs: result.elapsedMs });
      }
      return result;
    } catch (error) {
      if (this.cancelled) {
        this.patch({ phase: 'cancelled', elapsedMs: performance.now() - startedAt });
        return undefined;
      }
      this.patch({
        phase: 'error',
        elapsedMs: performance.now() - startedAt,
        failure: explainFailure({
          error,
          exitCode: error instanceof FfmpegExitError ? error.code : undefined,
          logs: this.client.logs(),
        }),
      });
      return undefined;
    } finally {
      this.stopTicker();
    }
  }

  /**
   * The multi-threaded core is the fragile one: when it falls over it takes
   * its instance with it. One retry on the single-threaded core turns that
   * into a slow success instead of a failure.
   */
  private async attempt(
    spec: JobSpec,
    variant: CoreVariant,
    startedAt: number,
  ): Promise<JobResult | undefined> {
    try {
      return await this.execute(spec, variant, startedAt);
    } catch (error) {
      if (this.cancelled || variant === 'st') throw error;
      this.client.terminate();
      return this.execute(spec, 'st', startedAt);
    }
  }

  private async execute(
    spec: JobSpec,
    variant: CoreVariant,
    startedAt: number,
  ): Promise<JobResult | undefined> {
    const coreNote = explainCoreChoice(
      variant,
      { estimatedOutputBytes: spec.estimatedOutputBytes, sourceHeight: spec.sourceHeight },
      this.client.capabilities,
    );

    this.patch({ phase: 'loading', variant, coreNote, ratio: undefined });
    await this.client.ensureLoaded(variant);
    if (this.cancelled) return undefined;

    const input = await this.client.mountInput(spec.media.file);
    const outputPath = `/out-${spec.media.id}-${Date.now()}.${extensionOf(spec.outputName)}`;

    const command = spec.build({ inputPath: input.path, outputPath });
    // The thread count is the core's business, so it is added here rather than
    // by the operation — the command we show the user stays paste-able.
    const args = withThreads(command, threadArgs(variant, this.client.capabilities.hardwareConcurrency));

    const tracker = new ProgressTracker(spec.durationSeconds);
    this.patch({ phase: 'running', variant, coreNote });

    try {
      const code = await this.client.exec(args, {
        onProgress: (event) => {
          const reading = tracker.push(event);
          this.patch({ ratio: reading.ratio });
        },
      });

      if (this.cancelled) return undefined;
      if (code !== 0) throw new FfmpegExitError(code, this.client.logs().slice(-40));

      const data = await this.client.readFile(outputPath);
      const blob = new Blob([data as BlobPart], { type: spec.outputMime });

      return {
        blob,
        bytes: blob.size,
        elapsedMs: performance.now() - startedAt,
        args,
        variant,
      };
    } finally {
      await this.client.deleteFile(outputPath);
      await this.client.unmount(input);
    }
  }

  /** Terminates the worker, then warms a replacement so the next run is quick. */
  cancel(): void {
    if (!this.isBusy()) return;
    this.cancelled = true;
    const variant = this.state().variant;
    this.client.terminate();
    this.patch({ phase: 'cancelled' });
    if (variant) void this.client.ensureLoaded(variant).catch(() => undefined);
  }

  reset(): void {
    this.stopTicker();
    this.state.set(IDLE);
    this.result.set(undefined);
  }

  private patch(changes: Partial<JobState>): void {
    this.state.update((current) => ({ ...current, ...changes }));
  }

  private startTicker(startedAt: number): void {
    this.stopTicker();
    this.ticker = setInterval(() => {
      this.patch({ elapsedMs: performance.now() - startedAt });
    }, 250);
  }

  private stopTicker(): void {
    if (this.ticker !== undefined) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}

/** FFmpeg ran and refused. The tail of the log is what explains why. */
export class FfmpegExitError extends Error {
  constructor(
    readonly code: number,
    readonly logTail: readonly string[],
  ) {
    super(`FFmpeg exited with code ${code}`);
    this.name = 'FfmpegExitError';
  }
}

/** Thread flags are input options, so they go after the input, before the output. */
function withThreads(command: readonly string[], threads: readonly string[]): string[] {
  if (threads.length === 0) return [...command];
  const afterInput = command.indexOf('-i') + 2;
  return [...command.slice(0, afterInput), ...threads, ...command.slice(afterInput)];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : 'out';
}
