import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import { previewCommand, type OperationContext } from './descriptor';
import {
  buildVideoTextArgs,
  DEFAULT_TEXT,
  escapeFilterValue,
  textFilter,
  textPlacement,
  textWindow,
  videoText,
  type VideoTextOptions,
} from './video-text';

const options = (overrides: Partial<VideoTextOptions> = {}): VideoTextOptions => ({
  ...DEFAULT_TEXT,
  text: 'Hello',
  ...overrides,
});

const info: MediaInfo = {
  source: 'ffprobe',
  kind: 'video',
  width: 1920,
  height: 1080,
  hasVideo: true,
  durationSeconds: 30,
  bitrate: 4_000_000,
};
const media = { id: 'f1', name: 'trip.mp4', kind: 'video' } as MediaFile;
const context: OperationContext = { media, info, inputs: [{ media, info }] };

describe('escapeFilterValue', () => {
  it('leaves ordinary words alone', () => {
    expect(escapeFilterValue('Summer 2026 — ünïcode')).toBe('Summer 2026 — ünïcode');
  });

  it('escapes for the option and then for the graph', () => {
    expect(escapeFilterValue(`It's 12:30`)).toBe(`It\\\\\\'s 12\\\\:30`);
    expect(escapeFilterValue('[a,b];')).toBe('\\[a\\,b\\]\\;');
    expect(escapeFilterValue('c\\d')).toBe('c\\\\\\\\d');
  });
});

describe('textPlacement', () => {
  it('centres the text across the frame at the top, middle and bottom', () => {
    expect(textPlacement('top')).toEqual({ x: '(w-tw)/2', y: 'h*0.05' });
    expect(textPlacement('middle')).toEqual({ x: '(w-tw)/2', y: '(h-th)/2' });
    expect(textPlacement('bottom')).toEqual({ x: '(w-tw)/2', y: 'h-th-h*0.05' });
  });

  it('keeps a margin from the corner', () => {
    expect(textPlacement('top-left')).toEqual({ x: 'h*0.05', y: 'h*0.05' });
    expect(textPlacement('bottom-right')).toEqual({ x: 'w-tw-h*0.05', y: 'h-th-h*0.05' });
  });
});

describe('textWindow', () => {
  it('shows throughout when neither time is set', () => {
    expect(textWindow(undefined, undefined)).toBeUndefined();
  });

  it('opens and closes on whichever times are set', () => {
    expect(textWindow(2, 5)).toBe('between(t,2,5)');
    expect(textWindow(2, undefined)).toBe('gte(t,2)');
    expect(textWindow(undefined, 5)).toBe('lte(t,5)');
  });
});

describe('textFilter', () => {
  it('draws bold white outlined text at the bottom by default', () => {
    expect(textFilter(options(), 1080)).toBe(
      'drawtext=fontfile=/fonts/DejaVuSans-Bold.ttf:expansion=none:text=Hello' +
        ':fontsize=h*7/100:fontcolor=white:x=(w-tw)/2:y=h-th-h*0.05' +
        ':borderw=5:bordercolor=black',
    );
  });

  it('puts a see-through box behind the text instead of an outline', () => {
    const filter = textFilter(options({ style: 'box' }), 1080);
    expect(filter).toContain(':box=1:boxcolor=black@0.6:boxborderw=19');
    expect(filter).not.toContain('borderw=5');
  });

  it('edges black text in white', () => {
    expect(textFilter(options({ color: 'black' }), 1080)).toContain('bordercolor=white');
  });

  it('draws nothing around plain text', () => {
    expect(textFilter(options({ style: 'plain' }), 1080)).not.toMatch(/border|box/);
  });

  it('uses the regular weight when bold is off', () => {
    expect(textFilter(options({ bold: false }), 1080)).toContain('fontfile=/fonts/DejaVuSans.ttf');
  });

  it('limits the text to its window, with the commas escaped for the graph', () => {
    expect(textFilter(options({ from: 1, to: 3.5 }), 1080)).toMatch(
      /:enable=between\(t\\,1\\,3\.5\)$/,
    );
  });
});

describe('buildVideoTextArgs', () => {
  it('draws the text and copies the sound', () => {
    const args = buildVideoTextArgs(
      options(),
      { inputPath: '/in.mp4', outputPath: '/out.mp4', fontsDir: '/fonts' },
      1080,
    );
    expect(args.slice(0, 3)).toEqual(['-i', '/in.mp4', '-vf']);
    expect(args[3]).toMatch(/^drawtext=.*,format=yuv420p$/);
    expect(args).toContain('libx264');
    expect(args.join(' ')).toContain('-c:a copy');
    expect(args.at(-1)).toBe('/out.mp4');
  });
});

describe('videoText', () => {
  it('asks for fonts', () => {
    expect(videoText.fonts).toBe(true);
  });

  it('will not run without something to write', () => {
    expect(videoText.incomplete?.({ ...DEFAULT_TEXT }, context)).toBeDefined();
    expect(videoText.incomplete?.(options({ text: '   ' }), context)).toBeDefined();
    expect(videoText.incomplete?.(options(), context)).toBeUndefined();
  });

  it('turns away a file with no picture', () => {
    expect(videoText.rejects?.({ ...context, info: { ...info, hasVideo: false } })).toBeDefined();
  });

  it('warns about a window that never opens', () => {
    expect(videoText.preflight?.(options({ from: 5, to: 2 }), context)).toHaveLength(1);
    expect(videoText.preflight?.(options({ from: 40 }), context)).toHaveLength(1);
    expect(videoText.preflight?.(options({ from: 2, to: 5 }), context)).toEqual([]);
  });

  it('shows a command that points at a local fonts folder', () => {
    expect(previewCommand(videoText, options(), context)).toContain(
      'fontfile=fonts/DejaVuSans-Bold.ttf',
    );
  });
});
