/**
 * VP8 is the WebM encoder Cinch uses, not VP9. Measured on the core's 5.1:
 * libvpx-vp9 crashes on its first packet of real footage ("memory access out
 * of bounds" on the MT core, a crash or hang on the ST one), alpha or not, and
 * no encoder option gets it through. Flat test colours encode fine, which is
 * why it went unnoticed. VP8 works on both cores.
 *
 * VP8 has no pure constant-quality mode: with a CRF it also wants a bitrate,
 * which it treats as a ceiling. So every quality-driven encode carries both.
 */

/** Used when the frame's size or rate is still being read. */
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const FALLBACK_FPS = 30;

/** VP8's CRF, worst to best. Its scale runs 4–63 and it needs more bits than VP9 for the same look. */
export const VP8_CRF_RANGE = [40, 10] as const;

/** 0.07 bits a pixel is about 1.9 Mb/s at 720p30 and 4.4 Mb/s at 1080p30. */
const BITS_PER_PIXEL = 0.07;

export function vp8Crf(quality: number): number {
  const [worst, best] = VP8_CRF_RANGE;
  const clamped = Math.min(100, Math.max(0, quality));
  return Math.round(worst - (clamped / 100) * (worst - best));
}

export type FrameShape = {
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
};

/** The bitrate ceiling for a frame of this size, in kb/s. */
export function vp8CeilingKbps(frame: FrameShape | undefined): number {
  const width = frame?.width ?? FALLBACK_WIDTH;
  const height = frame?.height ?? FALLBACK_HEIGHT;
  const fps = frame?.frameRate ?? FALLBACK_FPS;
  return Math.round((width * height * fps * BITS_PER_PIXEL) / 1000);
}

/** The encoder and its quality pairing, for a quality-driven VP8 encode. */
export function vp8QualityArgs(quality: number, frame: FrameShape | undefined): string[] {
  return [
    '-c:v',
    'libvpx',
    '-deadline',
    'realtime',
    '-crf',
    String(vp8Crf(quality)),
    '-b:v',
    `${vp8CeilingKbps(frame)}k`,
  ];
}
