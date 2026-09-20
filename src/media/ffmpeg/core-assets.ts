import type { CoreVariant } from './core-routing';

/**
 * Core files are copied verbatim into `dist/ffmpeg/...` with unhashed names.
 * These URLs are read at runtime by the FFmpeg worker, so the bundler never
 * sees them and cannot rewrite a hashed name back into them (D3).
 */
export interface CoreAssets {
  readonly coreURL: string;
  readonly wasmURL: string;
  /** The multi-threaded core spawns pthread workers from this file. */
  readonly workerURL?: string;
}

const PATHS: Readonly<Record<CoreVariant, readonly string[]>> = {
  st: ['ffmpeg/st/ffmpeg-core.js', 'ffmpeg/st/ffmpeg-core.wasm'],
  mt: ['ffmpeg/mt/ffmpeg-core.js', 'ffmpeg/mt/ffmpeg-core.wasm', 'ffmpeg/mt/ffmpeg-core.worker.js'],
};

/** Absolute, so the worker resolves them against the site and not against itself. */
export function coreAssetUrls(variant: CoreVariant): CoreAssets {
  const [core, wasm, worker] = PATHS[variant].map(absolute);
  return { coreURL: core, wasmURL: wasm, workerURL: worker };
}

export function coreAssetList(variant: CoreVariant): readonly string[] {
  return PATHS[variant].map(absolute);
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}
