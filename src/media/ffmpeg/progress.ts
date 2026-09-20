/**
 * FFmpeg's progress events cannot be trusted (D14b). Measured on this build:
 *
 * - `time` is microseconds of output written — 6_013_968 for a 6.01 s clip.
 * - `progress` is `out_time ÷ input #0 duration`, so it overshoots (1.0023 at
 *   the end of a plain transcode), caps early on a trim, doubles on a concat,
 *   and goes negative for lavfi sources.
 * - When `AV_NOPTS_VALUE` leaks through, `time` becomes an absurd number —
 *   FFmpeg's own log line shows it as `time=-577014:32:22.77`.
 *
 * So: prefer our own arithmetic against a duration we probed, treat FFmpeg's
 * ratio as a fallback, and show an indeterminate bar rather than a wrong one.
 */

export interface RawProgress {
  /** FFmpeg's own ratio. Anything outside roughly 0–1 is noise. */
  readonly progress: number;
  /** Microseconds of output written so far. */
  readonly time: number;
}

export interface ProgressReading {
  /** 0–1, or undefined when nothing trustworthy can be said. */
  readonly ratio?: number;
  readonly outTimeSeconds?: number;
}

/** Eleven days of output. Anything beyond this is a sentinel value, not a time. */
const MAX_PLAUSIBLE_SECONDS = 1_000_000;

export function readProgress(raw: RawProgress, durationSeconds?: number): ProgressReading {
  const outTimeSeconds = plausibleTime(raw.time);

  if (durationSeconds !== undefined && durationSeconds > 0 && outTimeSeconds !== undefined) {
    return { ratio: clamp01(outTimeSeconds / durationSeconds), outTimeSeconds };
  }

  // No duration to measure against: FFmpeg's own ratio, if it looks sane.
  if (Number.isFinite(raw.progress) && raw.progress >= 0 && raw.progress <= 1.5) {
    return { ratio: clamp01(raw.progress), outTimeSeconds };
  }

  return { outTimeSeconds };
}

/**
 * Keeps a job's progress honest over time: never goes backwards, and once a
 * reading is untrustworthy it holds the last good value instead of jumping.
 */
export class ProgressTracker {
  private best: number | undefined;
  private lastTime: number | undefined;

  constructor(private readonly durationSeconds?: number) {}

  push(raw: RawProgress): ProgressReading {
    const reading = readProgress(raw, this.durationSeconds);

    if (reading.outTimeSeconds !== undefined) this.lastTime = reading.outTimeSeconds;
    if (reading.ratio !== undefined && (this.best === undefined || reading.ratio > this.best)) {
      this.best = reading.ratio;
    }

    return { ratio: this.best, outTimeSeconds: this.lastTime };
  }

  /** Called when the job finishes, so the bar always lands on full. */
  complete(): ProgressReading {
    this.best = 1;
    return { ratio: 1, outTimeSeconds: this.lastTime };
  }

  get ratio(): number | undefined {
    return this.best;
  }
}

function plausibleTime(microseconds: number): number | undefined {
  if (!Number.isFinite(microseconds) || microseconds < 0) return undefined;
  const seconds = microseconds / 1_000_000;
  return seconds <= MAX_PLAUSIBLE_SECONDS ? seconds : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
