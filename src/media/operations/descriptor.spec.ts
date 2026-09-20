import { describe, expect, it } from 'vitest';
import {
  applyChange,
  decodeChoice,
  defineOperation,
  encodeChoice,
  initialOptions,
  outputNameFor,
  previewCommand,
  timestamp,
  visibleFields,
  type Choice,
} from './descriptor';

type Options = {
  readonly mode: string;
  readonly level: number;
  readonly extra?: number;
  readonly loud: boolean;
};

const operation = defineOperation<Options>({
  id: 'test-op',
  route: 'test',
  title: 'Test operation',
  verb: 'Test',
  summary: 'For the tests.',
  group: 'video',
  accepts: ['video'],
  defaults: { mode: 'a', level: 5, loud: false },
  outputSuffix: 'tested',
  fields: [
    {
      kind: 'segmented',
      key: 'mode',
      label: 'Mode',
      choices: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    {
      kind: 'slider',
      key: 'level',
      label: 'Level',
      min: 0,
      max: 10,
      visibleWhen: (options) => options.mode === 'a',
    },
    {
      kind: 'select',
      key: 'extra',
      label: 'Extra',
      choices: [
        { value: undefined, label: 'None' },
        { value: 0, label: 'Zero' },
        { value: 7, label: 'Seven' },
      ],
    },
  ],
  // Mode b has no level, so it is pinned at the top of the range.
  normalize: (options) => (options.mode === 'b' ? { ...options, level: 10 } : options),
  build: (options, paths) => ['-i', paths.inputPath, '-level', String(options.level), paths.outputPath],
  outputExtension: () => 'mp4',
  outputMime: () => 'video/mp4',
});

const context = {
  media: {
    id: 'f1',
    file: new File([], 'my holiday.mov'),
    name: 'my holiday.mov',
    size: 1000,
    extension: 'mov',
    kind: 'video' as const,
  },
};

describe('visibleFields', () => {
  it('leaves out the fields that have nothing to say', () => {
    const shown = visibleFields(operation, { mode: 'b', level: 10, loud: false }, context);
    expect(shown.map((field) => field.key)).toEqual(['mode', 'extra']);
  });
});

describe('applyChange', () => {
  it('runs the operation’s own normalize over the result', () => {
    const next = applyChange(operation, operation.defaults, { mode: 'b' }, context);
    expect(next).toEqual({ mode: 'b', level: 10, loud: false });
  });

  it('leaves a legal change alone', () => {
    const next = applyChange(operation, operation.defaults, { level: 3 }, context);
    expect(next['level']).toBe(3);
  });
});

describe('initialOptions', () => {
  it('normalizes the defaults rather than trusting them', () => {
    // The defaults say level 1; normalize says mode b is always 10.
    const normalizing = defineOperation<Options>({
      id: 'test-op-2',
      route: 'test-2',
      title: 'Second test operation',
      verb: 'Test',
      summary: 'For the tests.',
      group: 'video',
      accepts: ['video'],
      defaults: { mode: 'b', level: 1, loud: false },
      outputSuffix: 'tested',
      fields: [],
      normalize: (values) => ({ ...values, level: 10 }),
      build: (_values, paths) => ['-i', paths.inputPath, paths.outputPath],
      outputExtension: () => 'mp4',
      outputMime: () => 'video/mp4',
    });
    expect(initialOptions(normalizing, context)['level']).toBe(10);
  });
});

describe('choice encoding', () => {
  const choices: readonly Choice[] = [
    { value: undefined, label: 'None' },
    { value: 0, label: 'Zero' },
    { value: 7, label: 'Seven' },
  ];

  it('keeps undefined and 0 apart, which a string value cannot', () => {
    expect(encodeChoice(choices, undefined)).toBe('0');
    expect(encodeChoice(choices, 0)).toBe('1');
    expect(decodeChoice(choices, '0')).toBeUndefined();
    expect(decodeChoice(choices, '1')).toBe(0);
  });

  it('round-trips a number rather than handing back a string', () => {
    expect(decodeChoice(choices, encodeChoice(choices, 7))).toBe(7);
  });

  it('falls back to undefined for a value that is no longer offered', () => {
    expect(encodeChoice(choices, 99)).toBe('');
    expect(decodeChoice(choices, '')).toBeUndefined();
  });
});

describe('outputNameFor', () => {
  it('keeps the stem, swaps the extension and adds the suffix', () => {
    expect(outputNameFor(operation, operation.defaults, context)).toBe('my holiday-tested.mp4');
  });

  it('copes with a file that has no extension', () => {
    const named = { media: { ...context.media, name: 'clip', extension: '' } };
    expect(outputNameFor(operation, operation.defaults, named)).toBe('clip-tested.mp4');
  });
});

describe('previewCommand', () => {
  it('shows real file names, quoted so the line can be pasted', () => {
    expect(previewCommand(operation, operation.defaults, context)).toBe(
      `ffmpeg -i 'my holiday.mov' -level 5 'my holiday-tested.mp4'`,
    );
  });
});

describe('timestamp', () => {
  it('writes the form FFmpeg never misreads', () => {
    expect(timestamp(0)).toBe('00:00:00.000');
    expect(timestamp(12.5)).toBe('00:00:12.500');
    expect(timestamp(3661.25)).toBe('01:01:01.250');
  });

  it('never goes negative', () => {
    expect(timestamp(-5)).toBe('00:00:00.000');
  });
});
