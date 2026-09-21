import { describe, expect, it } from 'vitest';
import { MAX_MT_THREADS, threadArgs, withThreads } from './threads';

describe('threadArgs', () => {
  it('says nothing on the single-threaded core', () => {
    expect(threadArgs('st', 8)).toEqual([]);
  });

  it('always pins a thread count on the multi-threaded core', () => {
    // Left to itself, x264 picks a number that hangs the core.
    expect(threadArgs('mt', 8)).toEqual(['-threads', String(MAX_MT_THREADS)]);
  });

  it('never asks for more threads than the machine has', () => {
    expect(threadArgs('mt', 2)).toEqual(['-threads', '2']);
    expect(threadArgs('mt', 1)).toEqual(['-threads', '1']);
  });

  it('copes with a browser that will not say', () => {
    expect(threadArgs('mt', 0)).toEqual(['-threads', '1']);
    expect(threadArgs('mt', Number.NaN)).toEqual(['-threads', '1']);
  });
});

describe('withThreads', () => {
  const threads = ['-threads', '4'];

  it('leaves the command alone on the single-threaded core', () => {
    expect(withThreads(['-i', 'in.mp4', 'out.mp4'], [])).toEqual(['-i', 'in.mp4', 'out.mp4']);
  });

  it('puts the flags after the input, where they apply to the output', () => {
    expect(withThreads(['-i', 'in.mp4', '-c:v', 'libx264', 'out.mp4'], threads)).toEqual([
      '-i',
      'in.mp4',
      '-threads',
      '4',
      '-c:v',
      'libx264',
      'out.mp4',
    ]);
  });

  it('puts them after the last input when there are several', () => {
    // After the first, they would be an input option of the second.
    expect(withThreads(['-i', 'a.mp4', '-i', 'b.mp4', 'out.mp4'], threads)).toEqual([
      '-i',
      'a.mp4',
      '-i',
      'b.mp4',
      '-threads',
      '4',
      'out.mp4',
    ]);
  });

  it('pins a filter graph to one thread, which otherwise hangs the core', () => {
    expect(
      withThreads(['-i', 'a.mp4', '-i', 'b.mp4', '-filter_complex', 'x', 'out.mp4'], threads),
    ).toEqual([
      '-filter_complex_threads',
      '1',
      '-i',
      'a.mp4',
      '-i',
      'b.mp4',
      '-threads',
      '4',
      '-filter_complex',
      'x',
      'out.mp4',
    ]);
  });

  it('leaves a filter graph alone on the single-threaded core', () => {
    const command = ['-i', 'a.mp4', '-filter_complex', 'x', 'out.mp4'];
    expect(withThreads(command, [])).toEqual(command);
  });
});
