import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoFpsArgs,
  clampFps,
  DEFAULT_FPS,
  fpsFilter,
  videoFps,
  type VideoFpsOptions,
} from './video-fps';

const PATHS = { inputPath: 'in.mp4', outputPath: 'out.mp4' };

const options = (overrides: Partial<VideoFpsOptions> = {}): VideoFpsOptions => ({
  ...DEFAULT_FPS,
  ...overrides,
});

const info = (frameRate: number): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  durationSeconds: 60,
  bitrate: 4_000_000,
  frameRate,
  hasVideo: true,
  hasAudio: true,
});

describe('clampFps', () => {
  it('keeps a sensible rate', () => {
    expect(clampFps(30)).toBe(30);
  });

  it('reads an empty box as nothing asked for', () => {
    expect(clampFps(undefined)).toBeUndefined();
    expect(clampFps(0)).toBeUndefined();
  });

  it('holds the rate inside what is worth encoding', () => {
    expect(clampFps(1000)).toBe(240);
  });
});

describe('fpsFilter', () => {
  it('drops or repeats whole frames by default', () => {
    expect(fpsFilter(options({ fps: 24 }))).toBe('fps=24');
  });

  it('invents the frames in between when asked to be smooth', () => {
    expect(fpsFilter(options({ fps: 60, smooth: true }))).toBe('minterpolate=fps=60:mi_mode=mci');
  });

  it('has nothing to do with an empty box', () => {
    expect(fpsFilter(options({ fps: undefined }))).toBeUndefined();
  });
});

describe('buildVideoFpsArgs', () => {
  it('re-times the picture and copies the sound', () => {
    const args = buildVideoFpsArgs(options({ fps: 24 }), PATHS);

    expect(args.slice(0, 4)).toEqual(['-i', 'in.mp4', '-vf', 'fps=24']);
    expect(args).toContain('copy');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('leaves the filter out when nothing was asked for', () => {
    expect(buildVideoFpsArgs(options({ fps: undefined }), PATHS)).not.toContain('-vf');
  });
});

describe('the frame rate descriptor', () => {
  it('warns when the target is the rate it already runs at', () => {
    const warnings = videoFps.preflight?.(options({ fps: 30 }), { info: info(30) });
    expect(warnings?.[0]).toMatch(/already runs at/);
  });

  it('warns when the box has been left empty', () => {
    const warnings = videoFps.preflight?.(options({ fps: undefined }), { info: info(30) });
    expect(warnings?.[0]).toMatch(/Fill in a frame rate/);
  });

  it('says nothing when the rate is genuinely changing', () => {
    expect(videoFps.preflight?.(options({ fps: 60 }), { info: info(30) })).toEqual([]);
  });

  it('points out that inventing frames is pointless on the way down', () => {
    const field = videoFps.fields.find((candidate) => candidate.key === 'smooth');
    const warning = field?.warnWhen?.(options({ fps: 24, smooth: true }), { info: info(60) });
    expect(warning).toMatch(/only helps when going up/);
  });

  it('expects fewer bytes at a lower frame rate', () => {
    const lower = videoFps.estimateBytes?.(options({ fps: 15 }), { info: info(30) });
    const same = videoFps.estimateBytes?.(options({ fps: 30 }), { info: info(30) });
    expect(lower!).toBeLessThan(same!);
  });
});
