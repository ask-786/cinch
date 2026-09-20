import { describe, expect, it } from 'vitest';
import { MAX_MT_THREADS, threadArgs } from './threads';

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
