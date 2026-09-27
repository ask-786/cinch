/**
 * libopus in the core crashes on stereo sound ("memory access out of bounds")
 * at complexity 5 and above — and the default is 10. Mono encodes at any
 * level, which is how a test clip with a mono sine hid it. Measured on the
 * core's 5.1: levels 0–4 survive stereo, so every Opus encode pins 4.
 */
export const OPUS_COMPLEXITY: readonly string[] = ['-compression_level', '4'];

export function opusArgs(kbps: number): string[] {
  return ['-c:a', 'libopus', ...OPUS_COMPLEXITY, '-b:a', `${kbps}k`];
}
