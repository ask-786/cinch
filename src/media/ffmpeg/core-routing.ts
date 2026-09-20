/** Which of the two shipped cores a job should run on. */
export type CoreVariant = 'st' | 'mt';

/**
 * The multi-threaded core is 3–5× faster but its heap is a fixed 1 GB that
 * cannot grow, because shared memory cannot grow. The single-threaded core
 * starts at 32 MB and grows to 2 GB. So the fast core is also the one that
 * runs out of room first, and big jobs belong on the slow one (D12).
 */
export const MT_MAX_OUTPUT_BYTES = 250_000_000;
export const MT_MAX_HEIGHT = 1080;

export interface Capabilities {
  /** COOP/COEP are in place, so SharedArrayBuffer is usable. */
  readonly isolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number;
  readonly multithreadAvailable: boolean;
}

export function detectCapabilities(): Capabilities {
  const isolated = typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false;
  const sharedArrayBuffer = typeof SharedArrayBuffer === 'function';
  const hardwareConcurrency = navigator.hardwareConcurrency || 1;

  return {
    isolated,
    sharedArrayBuffer,
    hardwareConcurrency,
    multithreadAvailable: isolated && sharedArrayBuffer && hardwareConcurrency > 1,
  };
}

export interface JobShape {
  /**
   * Bytes we expect to write. Undefined means we genuinely do not know, which
   * routes to the core that can grow rather than the one that cannot.
   */
  readonly estimatedOutputBytes?: number;
  /** Height of the tallest input, when known. */
  readonly sourceHeight?: number;
}

export function chooseCore(job: JobShape, capabilities: Capabilities): CoreVariant {
  if (!capabilities.multithreadAvailable) return 'st';
  if (job.estimatedOutputBytes === undefined) return 'st';
  if (job.estimatedOutputBytes >= MT_MAX_OUTPUT_BYTES) return 'st';
  if (job.sourceHeight !== undefined && job.sourceHeight > MT_MAX_HEIGHT) return 'st';
  return 'mt';
}

/** Why a job ended up where it did — shown in the advanced disclosure. */
export function explainCoreChoice(
  variant: CoreVariant,
  job: JobShape,
  capabilities: Capabilities,
): string {
  if (variant === 'mt') return 'Using all cores';
  if (!capabilities.isolated) return 'Using one core: this page is not cross-origin isolated';
  if (!capabilities.sharedArrayBuffer) return 'Using one core: shared memory is unavailable here';
  if (capabilities.hardwareConcurrency <= 1) return 'Using one core: only one is available';
  if (job.estimatedOutputBytes === undefined) return 'Using one core: output size is unknown';
  if (job.estimatedOutputBytes >= MT_MAX_OUTPUT_BYTES) {
    return 'Using one core: the output is too large for the faster core’s fixed memory';
  }
  return 'Using one core: the source is larger than 1080p';
}
