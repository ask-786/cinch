/**
 * What went wrong, in the user's words (D17).
 *
 * FFmpeg says why it failed — but it says it in the last few lines of a log
 * that is mostly a banner, and it says it as `Invalid data found when
 * processing input`. This maps the failures we have actually seen onto a
 * sentence a person can act on. Unmatched failures still get the log.
 */

export type FailureKind =
  | 'memory'
  | 'unsupported-codec'
  | 'container-mismatch'
  | 'no-stream'
  | 'invalid-input'
  | 'no-space'
  | 'core-crash'
  | 'load-failed'
  | 'unknown';

export interface Explanation {
  readonly kind: FailureKind;
  readonly title: string;
  readonly detail: string;
  /** What to change to get a different outcome. */
  readonly hint?: string;
}

interface Pattern {
  readonly kind: FailureKind;
  readonly match: RegExp;
  readonly title: string;
  readonly detail: string;
  readonly hint?: string;
}

/**
 * Order matters: the memory patterns come first because an out-of-memory
 * death also prints a pile of ordinary-looking errors on its way down.
 */
const PATTERNS: readonly Pattern[] = [
  {
    kind: 'memory',
    match:
      /cannot enlarge memory|out of memory|memory access out of bounds|OOM|allocat\w* failed|bad_alloc|maximum call stack/i,
    title: 'The file was too big for the browser',
    detail:
      'A browser tab can only hold a couple of gigabytes, and this job needed more than that.',
    hint: 'Lower the resolution, pick a stronger compression setting, or trim the file down first.',
  },
  {
    kind: 'no-space',
    match: /no space left on device|ENOSPC/i,
    title: 'The output ran out of room',
    detail:
      'The result is written into memory before it is saved, and there was not enough of it left.',
    hint: 'Close other tabs and try again, or aim for a smaller output.',
  },
  {
    kind: 'unsupported-codec',
    match:
      /unknown encoder|unknown decoder|encoder .* not found|decoder .* not found|codec not currently supported/i,
    title: 'This build of FFmpeg cannot do that',
    detail: 'Cinch ships a fixed set of encoders. The one this job asked for is not among them.',
    hint: 'Pick one of the other formats — H.264 in MP4 works for everything.',
  },
  {
    kind: 'container-mismatch',
    match:
      /could not find tag for codec|only supports|does not support|incompatible with|muxer does not support/i,
    title: 'That format cannot hold that stream',
    detail: 'The container and the codec do not go together — WebM cannot hold AAC, for instance.',
    hint: 'Change the format, or let the stream be re-encoded instead of copied.',
  },
  {
    kind: 'no-stream',
    match:
      /does not contain any stream|matches no streams|output file is empty|no such file or directory/i,
    title: 'There was nothing to write',
    detail:
      'FFmpeg finished without producing a track — usually the input had no stream of the kind the operation needed.',
    hint: 'Check the file actually contains what you are asking for, such as an audio track.',
  },
  {
    kind: 'invalid-input',
    match:
      /invalid data found|moov atom not found|end of file|invalid argument|error opening input|header missing|unknown format/i,
    title: 'The file could not be read',
    detail:
      'FFmpeg could not make sense of the input. It may be truncated, still downloading, or not really the format its name claims.',
    hint: 'Try the file in a player first — if it will not play there, it will not convert here.',
  },
  {
    kind: 'core-crash',
    match: /startsWith|RuntimeError|abort\(|unreachable executed|table index is out of bounds/i,
    title: 'The media engine fell over',
    detail: 'The WebAssembly core crashed rather than reporting an error. It has been restarted.',
    hint: 'Running the same job again often works — the second attempt uses the slower, sturdier engine.',
  },
];

const LOAD_FAILURE = /failed to (fetch|load)|networkerror|import.*worker|sharedarraybuffer/i;

export interface FailureInput {
  /** The thrown error, if the job threw rather than exiting non-zero. */
  readonly error?: unknown;
  /** FFmpeg's own exit code, when it managed to return one. */
  readonly exitCode?: number;
  readonly logs?: readonly string[];
}

export function explainFailure(input: FailureInput): Explanation {
  const haystack = [messageOf(input.error), ...(input.logs ?? []).slice(-60)].join('\n');

  for (const pattern of PATTERNS) {
    if (pattern.match.test(haystack)) {
      return {
        kind: pattern.kind,
        title: pattern.title,
        detail: pattern.detail,
        hint: pattern.hint,
      };
    }
  }

  if (LOAD_FAILURE.test(haystack)) {
    return {
      kind: 'load-failed',
      title: 'The media engine could not be loaded',
      detail:
        'The 32 MB FFmpeg core did not download. That is usually a connection that dropped, or an extension blocking it.',
      hint: 'Reload the page and try again.',
    };
  }

  const line = lastUsefulLine(input.logs ?? []);
  return {
    kind: 'unknown',
    title: 'That did not work',
    detail:
      line ??
      (input.exitCode !== undefined
        ? `FFmpeg stopped with exit code ${input.exitCode}.`
        : messageOf(input.error) || 'FFmpeg stopped without saying why.'),
    hint: 'The log below has the whole story.',
  };
}

/**
 * The last line that says something. FFmpeg's tail is full of progress
 * counters and stream summaries, which explain nothing.
 */
export function lastUsefulLine(logs: readonly string[]): string | undefined {
  const noise =
    /^(\s*$|frame=|size=|video:|Stream mapping|Press \[q\]|\s*Metadata|\s*encoder\s*:|\s*handler_name)/;
  for (let index = logs.length - 1; index >= 0; index--) {
    const line = logs[index].trim();
    if (!line || noise.test(line)) continue;
    if (
      line.startsWith('ffmpeg version') ||
      line.startsWith('built with') ||
      line.startsWith('configuration:')
    ) {
      continue;
    }
    return line;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error === undefined || error === null) return '';
  if (error instanceof Error) return error.message;
  return String(error);
}
