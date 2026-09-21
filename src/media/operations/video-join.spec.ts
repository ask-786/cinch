import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoJoinArgs,
  DEFAULT_JOIN,
  joinAudio,
  joinFilter,
  joinFrame,
  joinFrameRate,
  videoJoin,
} from './video-join';

const clip = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width: 1920,
  height: 1080,
  frameRate: 30,
  durationSeconds: 10,
  hasVideo: true,
  hasAudio: true,
  ...overrides,
});

describe('joinAudio', () => {
  it('joins the sound when every clip has some', () => {
    expect(joinAudio([clip(), clip()])).toBe('all');
  });

  it('assumes sound until a probe says otherwise', () => {
    expect(joinAudio([clip(), undefined])).toBe('all');
  });

  it('fills a silent clip with silence of its own length', () => {
    expect(joinAudio([clip(), clip({ hasAudio: false })])).toBe('fill');
  });

  it('drops the sound when no clip has any', () => {
    expect(joinAudio([clip({ hasAudio: false }), clip({ hasAudio: false })])).toBe('none');
  });

  it('drops the sound when a silent clip cannot be measured', () => {
    expect(joinAudio([clip(), clip({ hasAudio: false, durationSeconds: undefined })])).toBe('none');
  });
});

describe('joinFrame', () => {
  it('follows the first clip by default', () => {
    expect(joinFrame(DEFAULT_JOIN, clip({ width: 1280, height: 720 }))).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('keeps the first clip’s shape at a chosen height, rounded to even', () => {
    // A portrait phone clip at 720p: 720 × 9/16 = 405 → 406.
    expect(
      joinFrame({ ...DEFAULT_JOIN, size: '720' }, clip({ width: 1080, height: 1920 })),
    ).toEqual({ width: 406, height: 720 });
  });

  it('falls back to 720p widescreen with nothing to go on', () => {
    expect(joinFrame(DEFAULT_JOIN, undefined)).toEqual({ width: 1280, height: 720 });
  });
});

describe('joinFrameRate', () => {
  it('keeps the first clip’s rate and falls back to 30', () => {
    expect(joinFrameRate(clip({ frameRate: 29.97 }))).toBe(29.97);
    expect(joinFrameRate(undefined)).toBe(30);
    expect(joinFrameRate(clip({ frameRate: 1000 }))).toBe(30);
  });
});

describe('joinFilter', () => {
  it('fits every clip into one frame, then joins picture and sound', () => {
    const { graph, audio } = joinFilter(DEFAULT_JOIN, [clip(), clip()]);
    expect(audio).toBe('all');
    expect(graph.split(';')).toEqual([
      '[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0]',
      '[0:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]',
      '[1:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v1]',
      '[1:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]',
      '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
    ]);
  });

  it('generates silence for a clip without sound', () => {
    const { graph } = joinFilter(DEFAULT_JOIN, [
      clip(),
      clip({ hasAudio: false, durationSeconds: 4.5 }),
    ]);
    expect(graph).toContain(
      'anullsrc=r=48000:cl=stereo,atrim=duration=4.5,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]',
    );
    expect(graph).not.toContain('[1:a:0]');
  });

  it('joins pictures only when there is no sound to join', () => {
    const { graph } = joinFilter(DEFAULT_JOIN, [
      clip({ hasAudio: false }),
      clip({ hasAudio: false }),
    ]);
    expect(graph).not.toContain(':a:0');
    expect(graph.endsWith('[v0][v1]concat=n=2:v=1:a=0[v]')).toBe(true);
  });
});

describe('buildVideoJoinArgs', () => {
  const paths = { inputPaths: ['/mnt1/a.mp4', '/mnt2/b.mov'], outputPath: '/out.mp4' };

  it('reads every input in order and maps the joined streams', () => {
    const args = buildVideoJoinArgs(DEFAULT_JOIN, paths, [clip(), clip()]);
    expect(args.slice(0, 4)).toEqual(['-i', '/mnt1/a.mp4', '-i', '/mnt2/b.mov']);
    expect(args).toContain('-filter_complex');
    expect(args.join(' ')).toContain('-map [v] -map [a]');
    expect(args).toContain('aac');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('writes no sound track when there is none to join', () => {
    const args = buildVideoJoinArgs(DEFAULT_JOIN, paths, [
      clip({ hasAudio: false }),
      clip({ hasAudio: false }),
    ]);
    expect(args).not.toContain('[a]');
    expect(args).toContain('-an');
  });
});

describe('videoJoin', () => {
  const media = (name: string) => ({
    id: name,
    file: new File([], name),
    name,
    size: 1,
    extension: 'mp4',
    kind: 'video' as const,
  });

  it('turns away a clip with no picture, by name', () => {
    const context = {
      inputs: [
        { media: media('a.mp4'), info: clip() },
        { media: media('b.mp4'), info: clip({ hasVideo: false }) },
      ],
    };
    expect(videoJoin.rejects?.(context)).toBe('b.mp4 has no picture to join.');
  });

  it('adds up the clips for the progress bar', () => {
    const context = {
      inputs: [
        { media: media('a.mp4'), info: clip({ durationSeconds: 3 }) },
        { media: media('b.mp4'), info: clip({ durationSeconds: 4.5 }) },
      ],
    };
    expect(videoJoin.outputDuration?.(DEFAULT_JOIN, context)).toBe(7.5);
  });

  it('estimates a size once every clip is measured, so the job can use every core', () => {
    const measured = {
      inputs: [
        { media: media('a.mp4'), info: clip() },
        { media: media('b.mp4'), info: clip() },
      ],
    };
    expect(videoJoin.estimateBytes?.(DEFAULT_JOIN, measured)).toBeGreaterThan(0);
    const unmeasured = {
      inputs: [{ media: media('a.mp4'), info: clip() }, { media: media('b.mp4') }],
    };
    expect(videoJoin.estimateBytes?.(DEFAULT_JOIN, unmeasured)).toBeUndefined();
  });
});
