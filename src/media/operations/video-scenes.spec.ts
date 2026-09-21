import { describe, expect, it } from 'vitest';
import {
  buildVideoScenesArgs,
  DEFAULT_SCENES,
  sceneFilter,
  videoScenes,
  type VideoScenesOptions,
} from './video-scenes';

const options = (overrides: Partial<VideoScenesOptions> = {}): VideoScenesOptions => ({
  ...DEFAULT_SCENES,
  ...overrides,
});

describe('sceneFilter', () => {
  it('keeps the first frame and every frame that differs enough from the last', () => {
    expect(sceneFilter(options())).toBe("select='eq(n,0)+gt(scene,0.3)',scale='min(1280,iw)':-2");
  });

  it('lowers the bar as the sensitivity goes up', () => {
    expect(sceneFilter(options({ sensitivity: 'high' }))).toContain('gt(scene,0.2)');
    expect(sceneFilter(options({ sensitivity: 'low' }))).toContain('gt(scene,0.45)');
  });
});

describe('buildVideoScenesArgs', () => {
  it('writes only the picked frames, as a numbered run', () => {
    expect(
      buildVideoScenesArgs(options(), { inputPath: 'in.mp4', outputPath: '/out-1/%04d.jpg' }),
    ).toEqual([
      '-i',
      'in.mp4',
      '-vf',
      sceneFilter(options()),
      '-fps_mode',
      'vfr',
      '-an',
      '-q:v',
      '2',
      '-f',
      'image2',
      '/out-1/%04d.jpg',
    ]);
  });
});

describe('videoScenes', () => {
  it('guesses a cut every five seconds for the estimate', () => {
    const info = {
      source: 'ffprobe' as const,
      kind: 'video' as const,
      width: 1920,
      height: 1080,
      durationSeconds: 50,
    };
    expect(videoScenes.estimateBytes?.(options(), { info })).toBe(
      Math.round(10 * 1280 * 720 * 0.2),
    );
  });
});
