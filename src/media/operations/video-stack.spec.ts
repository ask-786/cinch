import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import {
  buildVideoStackArgs,
  DEFAULT_STACK,
  stackCell,
  stackFilter,
  stackFrame,
  stackShape,
  stackSoundSources,
  videoStack,
  type VideoStackOptions,
} from './video-stack';

const options = (overrides: Partial<VideoStackOptions> = {}): VideoStackOptions => ({
  ...DEFAULT_STACK,
  ...overrides,
});

const clip = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasVideo: true,
  hasAudio: true,
  durationSeconds: 10,
  ...overrides,
});

const TILE =
  'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p';

describe('stackShape', () => {
  it('lays a row out as one line and a column as one stack', () => {
    expect(stackShape('row', 3)).toEqual({ columns: 3, rows: 1 });
    expect(stackShape('column', 3)).toEqual({ columns: 1, rows: 3 });
  });

  it('makes the squarest grid that fits every clip', () => {
    expect(stackShape('grid', 4)).toEqual({ columns: 2, rows: 2 });
    expect(stackShape('grid', 3)).toEqual({ columns: 2, rows: 2 });
    expect(stackShape('grid', 5)).toEqual({ columns: 3, rows: 2 });
    expect(stackShape('grid', 9)).toEqual({ columns: 3, rows: 3 });
  });
});

describe('stackCell and stackFrame', () => {
  it('shapes each cell like the first clip, at the chosen height', () => {
    expect(stackCell(options(), clip())).toEqual({ width: 960, height: 540 });
    expect(stackCell(options({ size: '720' }), clip({ width: 1080, height: 1920 }))).toEqual({
      width: 406,
      height: 720,
    });
  });

  it('multiplies the cell out by the layout', () => {
    expect(stackFrame(options(), [clip(), clip()])).toEqual({ width: 1920, height: 540 });
    expect(stackFrame(options({ layout: 'grid' }), [clip(), clip(), clip()])).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});

describe('stackSoundSources', () => {
  it('takes the first clip that has sound, or all of them', () => {
    const inputs = [clip({ hasAudio: false }), clip(), clip()];
    expect(stackSoundSources('first', inputs)).toEqual([1]);
    expect(stackSoundSources('mix', inputs)).toEqual([1, 2]);
    expect(stackSoundSources('none', inputs)).toEqual([]);
  });
});

describe('stackFilter', () => {
  it('fits both clips into one cell and puts them side by side', () => {
    expect(stackFilter(options(), [clip(), clip()])).toBe(
      `[0:v:0]${TILE}[t0];[1:v:0]${TILE}[t1];[t0][t1]hstack=inputs=2:shortest=0[v]`,
    );
  });

  it('stops at the first clip to end when asked', () => {
    expect(
      stackFilter(options({ layout: 'column', length: 'shortest' }), [clip(), clip()]),
    ).toContain('vstack=inputs=2:shortest=1[v]');
  });

  it('fills a grid that is not full with black cells as long as the first clip', () => {
    const graph = stackFilter(options({ layout: 'grid' }), [clip(), clip(), clip()]);
    expect(graph).toContain(`[0:v:0]${TILE}[first]`);
    expect(graph).toContain('[first]split=2[t0][c0];[c0]drawbox=c=black:t=fill[b0]');
    expect(graph).toContain(
      '[t0][t1][t2][b0]xstack=inputs=4:layout=0_0|960_0|0_540|960_540:shortest=0[v]',
    );
  });

  it('mixes the sound of every clip that has some', () => {
    expect(stackFilter(options({ sound: 'mix' }), [clip(), clip()])).toContain(
      '[0:a:0][1:a:0]amix=inputs=2:duration=longest:normalize=0[a]',
    );
  });
});

describe('buildVideoStackArgs', () => {
  const paths = { inputPaths: ['a.mp4', 'b.mp4'], outputPath: 'out.mp4' };

  it("maps one clip's sound straight across", () => {
    const args = buildVideoStackArgs(options(), paths, [clip(), clip()]);
    expect(args.slice(0, 4)).toEqual(['-i', 'a.mp4', '-i', 'b.mp4']);
    expect(args.join(' ')).toContain('-map [v] -map 0:a:0 -c:v libx264');
    expect(args).toContain('aac');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('cuts the sound at the picture when the shortest clip sets the length', () => {
    const args = buildVideoStackArgs(options({ length: 'shortest' }), paths, [clip(), clip()]);
    expect(args).toContain('-shortest');
  });

  it('maps the mix, or no sound at all', () => {
    expect(buildVideoStackArgs(options({ sound: 'mix' }), paths, [clip(), clip()])).toContain(
      '[a]',
    );
    expect(buildVideoStackArgs(options({ sound: 'none' }), paths, [clip(), clip()])).toContain(
      '-an',
    );
  });
});

describe('videoStack', () => {
  const inputs = (infos: MediaInfo[]) =>
    infos.map((info, index) => ({
      media: { id: String(index), name: `clip${index}.mp4`, kind: 'video' } as MediaFile,
      info,
    }));

  it('warns when the result would be bigger than 4K', () => {
    const many = inputs([clip(), clip(), clip(), clip(), clip()]);
    expect(videoStack.preflight?.(options({ size: '720' }), { inputs: many }).join(' ')).toMatch(
      /bigger than 4K/,
    );
  });

  it('lasts as long as the longest clip, or the shortest', () => {
    const pair = inputs([clip({ durationSeconds: 4 }), clip({ durationSeconds: 9 })]);
    expect(videoStack.outputDuration?.(options(), { inputs: pair })).toBe(9);
    expect(videoStack.outputDuration?.(options({ length: 'shortest' }), { inputs: pair })).toBe(4);
  });

  it('gives an estimate, so the job can run on every core', () => {
    const pair = inputs([clip(), clip()]);
    expect(videoStack.estimateBytes?.(options(), { inputs: pair })).toBeGreaterThan(0);
  });
});
