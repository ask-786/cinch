import { Injectable, signal } from '@angular/core';
import { FFFSType, FFmpeg, type LogEvent, type ProgressEvent } from '@ffmpeg/ffmpeg';
import { coreAssetList, coreAssetUrls } from '../../media/ffmpeg/core-assets';
import { detectCapabilities, type CoreVariant } from '../../media/ffmpeg/core-routing';

export type FfmpegStatus = 'idle' | 'loading' | 'ready' | 'running';

export interface ExecOptions {
  readonly onProgress?: (event: ProgressEvent) => void;
  readonly onLog?: (line: string) => void;
}

/** How many log lines to keep for the error taxonomy and the logs panel. */
const LOG_BUFFER = 400;
const CACHE_NAME = 'cinch-ffmpeg-core-v1';

/**
 * Owns the FFmpeg instance and its worker.
 *
 * `FFmpeg` from @ffmpeg/ffmpeg already spawns its own module worker and runs
 * every exec there, so the UI thread only ever posts messages. This class is
 * the single place that knows that — everything above it sees a typed API.
 *
 * Only one job may run at a time: the worker's `exec` is synchronous, so a
 * second call would simply queue behind the first with no way to interrupt it.
 */
@Injectable({ providedIn: 'root' })
export class FfmpegClient {
  readonly capabilities = detectCapabilities();

  readonly status = signal<FfmpegStatus>('idle');
  readonly loadedVariant = signal<CoreVariant | undefined>(undefined);
  readonly logs = signal<readonly string[]>([]);

  private ffmpeg?: FFmpeg;
  private loading?: Promise<void>;
  private mountCount = 0;
  private activeExec?: ExecOptions;

  /**
   * Fetches the ~32 MB core into the Cache API without instantiating it, so
   * the first real job starts immediately. Safe to call repeatedly.
   */
  prewarm(variant: CoreVariant): void {
    if (typeof caches === 'undefined') return;

    const cacheFiles = async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        for (const url of coreAssetList(variant)) {
          if (await cache.match(url)) continue;
          await cache.add(url);
        }
      } catch {
        // Storage may be full or blocked; the core will just download on demand.
      }
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => void cacheFiles(), { timeout: 10_000 });
    } else {
      setTimeout(() => void cacheFiles(), 2000);
    }
  }

  /** Loads the requested core, swapping instances if a different one is live. */
  async ensureLoaded(variant: CoreVariant): Promise<void> {
    if (this.ffmpeg && this.loadedVariant() === variant) return;
    if (this.loading && this.loadedVariant() === variant) return this.loading;

    if (this.ffmpeg) this.terminate();

    this.status.set('loading');
    this.loadedVariant.set(variant);
    this.loading = this.startLoad(variant);

    try {
      await this.loading;
      this.status.set('ready');
    } catch (error) {
      this.status.set('idle');
      this.loadedVariant.set(undefined);
      this.ffmpeg = undefined;
      throw error;
    } finally {
      this.loading = undefined;
    }
  }

  private async startLoad(variant: CoreVariant): Promise<void> {
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', (event: LogEvent) => {
      this.appendLog(event.message);
      this.activeExec?.onLog?.(event.message);
    });
    ffmpeg.on('progress', (event: ProgressEvent) => {
      this.activeExec?.onProgress?.(event);
    });

    const assets = coreAssetUrls(variant);
    await ffmpeg.load({
      // Always explicit: 0.12.15 still defaults to an unpkg URL for an older core.
      coreURL: assets.coreURL,
      wasmURL: assets.wasmURL,
      ...(assets.workerURL ? { workerURL: assets.workerURL } : {}),
    });

    this.ffmpeg = ffmpeg;
  }

  /**
   * Mounts a file read-only via WORKERFS: the worker reads it in chunks with
   * FileReaderSync, so a 2 GB input never enters JS memory. Returns the path
   * FFmpeg should use as `-i`.
   */
  async mountInput(file: File): Promise<MountedInput> {
    const ffmpeg = this.require();
    const mountPoint = `/mnt${++this.mountCount}`;

    await ffmpeg.createDir(mountPoint);
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountPoint);

    return {
      path: `${mountPoint}/${file.name}`,
      mountPoint,
    };
  }

  async unmount(input: MountedInput): Promise<void> {
    const ffmpeg = this.ffmpeg;
    if (!ffmpeg) return;
    try {
      await ffmpeg.unmount(input.mountPoint);
      await ffmpeg.deleteDir(input.mountPoint);
    } catch {
      // The instance may have been terminated mid-job; nothing to clean up then.
    }
  }

  /**
   * Runs one command. Resolves with FFmpeg's exit code — a non-zero code is an
   * ordinary FFmpeg failure and the instance survives it.
   *
   * A *thrown* error is different: it means the core itself fell over, and
   * every later call on that instance throws too. Measured on the MT core with
   * too many threads. So a throw takes the instance down with it.
   */
  async exec(args: readonly string[], options: ExecOptions = {}): Promise<number> {
    return this.guarded((ffmpeg) => ffmpeg.exec([...args]), options);
  }

  /** Same, for the ffprobe entry point compiled into the same core. */
  async ffprobe(args: readonly string[], options: ExecOptions = {}): Promise<number> {
    return this.guarded((ffmpeg) => ffmpeg.ffprobe([...args]), options);
  }

  private async guarded(
    call: (ffmpeg: FFmpeg) => Promise<number>,
    options: ExecOptions,
  ): Promise<number> {
    const ffmpeg = this.require();
    this.status.set('running');
    this.activeExec = options;
    try {
      const code = await call(ffmpeg);
      this.activeExec = undefined;
      if (this.ffmpeg === ffmpeg) this.status.set('ready');
      return code;
    } catch (error) {
      this.activeExec = undefined;
      if (this.ffmpeg === ffmpeg) this.terminate();
      throw error;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = await this.require().readFile(path, 'binary');
    return data as Uint8Array;
  }

  async readText(path: string): Promise<string> {
    const data = await this.require().readFile(path, 'utf8');
    return data as string;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await this.require().writeFile(path, data);
  }

  async createDir(path: string): Promise<void> {
    await this.require().createDir(path);
  }

  /** The names of the plain files in a folder, without `.` and `..`. */
  async listFiles(path: string): Promise<string[]> {
    const nodes = await this.require().listDir(path);
    return nodes.filter((node) => !node.isDir).map((node) => node.name);
  }

  /** Empties a folder and removes it. Quiet when there is nothing left to do. */
  async deleteDir(path: string): Promise<void> {
    try {
      for (const name of await this.listFiles(path)) await this.deleteFile(`${path}/${name}`);
      await this.require().deleteDir(path);
    } catch {
      // Already gone, or the instance is down.
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.require().deleteFile(path);
    } catch {
      // Already gone, or the instance is down. Either way there is nothing to do.
    }
  }

  /**
   * The only way to stop a running job: the WASM keeps going otherwise, and an
   * AbortSignal would reject our promise while the work continued (D14).
   * Everything in the virtual filesystem is lost with it.
   */
  terminate(): void {
    this.ffmpeg?.terminate();
    this.ffmpeg = undefined;
    this.loading = undefined;
    this.activeExec = undefined;
    this.loadedVariant.set(undefined);
    this.status.set('idle');
  }

  clearLogs(): void {
    this.logs.set([]);
  }

  private require(): FFmpeg {
    if (!this.ffmpeg) throw new Error('FFmpeg is not loaded yet.');
    return this.ffmpeg;
  }

  private appendLog(line: string): void {
    this.logs.update((current) => {
      const next = current.length >= LOG_BUFFER ? current.slice(1) : current.slice();
      next.push(line);
      return next;
    });
  }
}

export interface MountedInput {
  /** What to hand FFmpeg as an input path. */
  readonly path: string;
  readonly mountPoint: string;
}
