import { describe, expect, it } from 'vitest';
import { hasManyOutputs, inputCountOf, SEQUENCE_TOKEN } from './descriptor';
import { groupOperations, operationByRoute, operationsFor, OPERATIONS } from './registry';

describe('the registry', () => {
  it('gives every operation a unique id and route', () => {
    expect(new Set(OPERATIONS.map((operation) => operation.id)).size).toBe(OPERATIONS.length);
    expect(new Set(OPERATIONS.map((operation) => operation.route)).size).toBe(OPERATIONS.length);
  });

  it('keeps operation routes clear of the fixed ones', () => {
    const reserved = ['', 'about'];
    for (const operation of OPERATIONS) {
      expect(reserved).not.toContain(operation.route);
    }
  });

  it('starts every operation from defaults its own normalize accepts', () => {
    for (const operation of OPERATIONS) {
      const normalized = operation.normalize?.(operation.defaults, {}) ?? operation.defaults;
      // Normalizing twice must not keep changing the answer.
      const twice = operation.normalize?.(normalized, {}) ?? normalized;
      expect(twice).toEqual(normalized);
    }
  });

  it('builds a command for every operation without a file to look at', () => {
    for (const operation of OPERATIONS) {
      const options = operation.normalize?.(operation.defaults, {}) ?? operation.defaults;
      const inputPaths = Array.from(
        { length: inputCountOf(operation).min },
        (_, i) => `in${i}.mp4`,
      );
      const outputPath = hasManyOutputs(operation) ? `out-${SEQUENCE_TOKEN}.jpg` : 'out.mp4';
      const args = operation.build(
        options,
        { inputPath: inputPaths[0], inputPaths, outputPath },
        {},
      );
      expect(args[0]).toMatch(/^-/);
      for (const path of inputPaths) expect(args).toContain(path);
      expect(args.at(-1)).toBe(outputPath);
    }
  });

  it('only names fields that exist in its own defaults', () => {
    for (const operation of OPERATIONS) {
      for (const field of operation.fields) {
        expect(Object.keys(operation.defaults)).toContain(field.key);
      }
    }
  });
});

describe('operationByRoute', () => {
  it('finds an operation by its URL segment', () => {
    expect(operationByRoute('compress')?.id).toBe('video-compress');
  });

  it('returns nothing for an unknown or missing segment', () => {
    expect(operationByRoute('nonsense')).toBeUndefined();
    expect(operationByRoute(null)).toBeUndefined();
  });
});

describe('operationsFor', () => {
  it('offers the video operations for a video', () => {
    const ids = operationsFor(['video']).map((operation) => operation.id);
    expect(ids).toContain('video-compress');
    expect(ids).toContain('video-trim');
    // Extracting audio from a video is a video job too.
    expect(ids).toContain('audio-extract');
  });

  it('offers only what an audio file can do', () => {
    expect(operationsFor(['audio']).map((operation) => operation.id)).toEqual(['audio-extract']);
  });

  it('offers joining only once there are two videos to join', () => {
    expect(operationsFor(['video']).map((operation) => operation.id)).not.toContain('video-join');
    expect(operationsFor(['video', 'video']).map((operation) => operation.id)).toContain(
      'video-join',
    );
    expect(operationsFor(['video', 'audio']).map((operation) => operation.id)).not.toContain(
      'video-join',
    );
  });

  it('offers nothing for a kind no operation accepts yet', () => {
    expect(operationsFor(['image'])).toEqual([]);
  });
});

describe('groupOperations', () => {
  it('skips the groups with nothing in them', () => {
    const groups = groupOperations(operationsFor(['audio']));
    expect(groups.map((group) => group.group)).toEqual(['audio']);
  });
});
