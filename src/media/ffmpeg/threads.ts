import type { CoreVariant } from './core-routing';

/**
 * Measured on the shipped core-mt 0.12.10 build (Chrome, 8 logical cores):
 *
 * | `-threads` | libx264 result                                    |
 * |-----------:|---------------------------------------------------|
 * |          4 | 6.0 s for a 6 s 720p clip — 2.6× the single core   |
 * |          6 | throws immediately inside the core                 |
 * |          8 | hangs forever; only `terminate()` recovers         |
 * | (omitted)  | hangs forever — x264 picks its own thread count    |
 *
 * So the multi-threaded core is only safe with an explicit, capped thread
 * count. A failed exec also poisons the instance: every later call throws
 * until it is terminated and reloaded.
 */
export const MAX_MT_THREADS = 4;

/** Args that must be present on every multi-threaded job. Empty for the ST core. */
export function threadArgs(variant: CoreVariant, hardwareConcurrency: number): readonly string[] {
  if (variant === 'st') return [];
  const threads = Math.max(1, Math.min(MAX_MT_THREADS, Math.floor(hardwareConcurrency) || 1));
  return ['-threads', String(threads)];
}

/**
 * Adds the thread flags to a command as output options: after the last input,
 * before anything about the output. After the *first* input would make them
 * an input option of the second, and the encoder would pick its own count.
 *
 * A `-filter_complex` graph also gets `-filter_complex_threads 1`. Measured
 * 2026-09-21 on a two-clip join: left at its default, the graph's own threads
 * on top of x264's four hang the MT core just like an unpinned x264 does;
 * pinned to one, the same join takes 5 s. Simple `-vf` chains are unaffected.
 */
export function withThreads(command: readonly string[], threads: readonly string[]): string[] {
  if (threads.length === 0) return [...command];
  const graph = command.includes('-filter_complex') ? ['-filter_complex_threads', '1'] : [];
  const afterInputs = command.lastIndexOf('-i') + 2;
  return [...graph, ...command.slice(0, afterInputs), ...threads, ...command.slice(afterInputs)];
}
