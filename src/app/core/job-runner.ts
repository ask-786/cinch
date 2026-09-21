import { computed, inject, Injectable, signal } from '@angular/core';
import { chooseCore, explainCoreChoice, type CoreVariant } from '../../media/ffmpeg/core-routing';
import { explainFailure, type Explanation } from '../../media/ffmpeg/errors';
import { ProgressTracker } from '../../media/ffmpeg/progress';
import { threadArgs, withThreads } from '../../media/ffmpeg/threads';
import type { MediaFile } from '../../media/models/media-file';
import { SEQUENCE_TOKEN, sequenceName, type BuildPaths } from '../../media/operations/descriptor';
import { FfmpegClient, type MountedInput } from './ffmpeg-client';

export type JobPaths = BuildPaths;

export interface JobSpec {
  /** One file for most operations; several, in order, for join and friends. */
  readonly inputs: readonly MediaFile[];
  /**
   * File name offered when saving, e.g. `holiday-compressed.mp4`. For a
   * numbered run it is the pattern, `holiday-frame-%04d.jpg`.
   */
  readonly outputName: string;
  readonly outputs: 'one' | 'many';
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

export interface OutputFile {
  readonly name: string;
  readonly blob: Blob;
}

export interface JobResult {
  /** One file, or the numbered run in order. Never empty. */
  readonly files: readonly OutputFile[];
  /** All of them together. */
  readonly bytes: number;
  readonly elapsedMs: number;
  /** What actually ran, including the thread count the core needed. */
  readonly args: readonly string[];
  readonly variant: CoreVariant;
}

const IDLE: JobState = { phase: 'idle', elapsedMs: 0 };

let runCounter = 0;

/**
 * Runs one job at a time and keeps the UI's view of it in signals.
 *
 * Cancelling means terminating the worker: FFmpeg's WASM cannot be interrupted
 * and an AbortSignal would only reject our promise while the work carried on
 * (D14). The filesystem goes with it, which is why every job mounts its own
 * inputs and writes its own output.
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

    const mounts: MountedInput[] = [];
    // A numbered run gets a folder of its own, so what FFmpeg wrote is simply
    // everything in it.
    const outputDir = spec.outputs === 'many' ? `/out-${++runCounter}` : undefined;
    const outputPath = outputDir
      ? `${outputDir}/${SEQUENCE_TOKEN}.${extensionOf(spec.outputName)}`
      : `/out-${++runCounter}.${extensionOf(spec.outputName)}`;

    try {
      // Each input on its own mount point: two files called `clip.mp4` from
      // different folders would otherwise land on the same path.
      for (const media of spec.inputs) mounts.push(await this.client.mountInput(media.file));
      if (outputDir) await this.client.createDir(outputDir);

      const inputPaths = mounts.map((mount) => mount.path);
      const command = spec.build({ inputPath: inputPaths[0], inputPaths, outputPath });
      // The thread count is the core's business, so it is added here rather than
      // by the operation — the command we show the user stays paste-able.
      const args = withThreads(
        command,
        threadArgs(variant, this.client.capabilities.hardwareConcurrency),
      );

      const tracker = new ProgressTracker(spec.durationSeconds);
      this.patch({ phase: 'running', variant, coreNote });

      const code = await this.client.exec(args, {
        onProgress: (event) => {
          const reading = tracker.push(event);
          this.patch({ ratio: reading.ratio });
        },
      });

      if (this.cancelled) return undefined;
      if (code !== 0) throw new FfmpegExitError(code, this.client.logs().slice(-40));

      const files = outputDir
        ? await this.collectSequence(outputDir, spec)
        : [await this.collectOne(outputPath, spec)];
      if (files.length === 0) throw new Error('FFmpeg finished without writing a file.');

      return {
        files,
        bytes: files.reduce((sum, file) => sum + file.blob.size, 0),
        elapsedMs: performance.now() - startedAt,
        args,
        variant,
      };
    } finally {
      if (outputDir) await this.client.deleteDir(outputDir);
      else await this.client.deleteFile(outputPath);
      for (const mount of mounts) await this.client.unmount(mount);
    }
  }

  private async collectOne(path: string, spec: JobSpec): Promise<OutputFile> {
    const data = await this.client.readFile(path);
    return { name: spec.outputName, blob: new Blob([data as BlobPart], { type: spec.outputMime }) };
  }

  /**
   * Reads the run back in order, deleting each file as it goes: every byte is
   * briefly in both the WASM heap and JS, and the heap is the tighter of the two.
   */
  private async collectSequence(dir: string, spec: JobSpec): Promise<OutputFile[]> {
    const names = (await this.client.listFiles(dir)).sort();
    const files: OutputFile[] = [];
    for (const name of names) {
      const path = `${dir}/${name}`;
      const data = await this.client.readFile(path);
      await this.client.deleteFile(path);
      files.push({
        name: sequenceName(spec.outputName, stemOf(name)),
        blob: new Blob([data as BlobPart], { type: spec.outputMime }),
      });
    }
    return files;
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

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : 'out';
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
