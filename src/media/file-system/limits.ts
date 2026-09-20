import { formatBytes } from '../humanize';

/**
 * The WASM heap is the ceiling: 2 GB single-threaded, 1 GB multi-threaded, and
 * output has to fit in MEMFS. These numbers keep users on the right side of it.
 * They are decimal megabytes so the constant and the message agree.
 */
export const DESKTOP_WARN_BYTES = 500_000_000;
export const MOBILE_CAP_BYTES = 150_000_000;

export type PreflightLevel = 'ok' | 'warn' | 'block';

export interface Preflight {
  readonly level: PreflightLevel;
  readonly message?: string;
}

const OK: Preflight = { level: 'ok' };

/**
 * Pure so it can be tested; the caller decides what "mobile" means.
 * On phones the tab is killed rather than told it is out of memory, so the cap
 * there is a hard stop instead of a warning.
 */
export function preflightSize(bytes: number, isMobile: boolean): Preflight {
  if (isMobile && bytes > MOBILE_CAP_BYTES) {
    return {
      level: 'block',
      message:
        `This file is ${formatBytes(bytes)}. On a phone or tablet, Cinch can handle up to ` +
        `${formatBytes(MOBILE_CAP_BYTES)} before the browser runs out of memory. Try it on a computer.`,
    };
  }

  if (!isMobile && bytes > DESKTOP_WARN_BYTES) {
    return {
      level: 'warn',
      message:
        `This file is ${formatBytes(bytes)}. Files this large can run out of memory part way ` +
        `through — it is worth trimming first, or expecting it to take a while.`,
    };
  }

  return OK;
}

/** Coarse but good enough: it only decides which size limit applies. */
export function isMobileDevice(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof data?.mobile === 'boolean') return data.mobile;
  return matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 900px)').matches;
}
