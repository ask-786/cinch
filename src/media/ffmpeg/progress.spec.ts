import { describe, expect, it } from 'vitest';
import { ProgressTracker, readProgress } from './progress';

describe('readProgress', () => {
  it('measures against the duration we probed', () => {
    // Real event from a 6.01 s clip, three seconds in.
    const reading = readProgress({ progress: 0.5, time: 3_000_000 }, 6);
    expect(reading.ratio).toBeCloseTo(0.5);
    expect(reading.outTimeSeconds).toBeCloseTo(3);
  });

  it('caps the overshoot FFmpeg reports at the end of a transcode', () => {
    const reading = readProgress({ progress: 1.002328, time: 6_013_968 }, 6);
    expect(reading.ratio).toBe(1);
  });

  it('falls back to FFmpeg’s ratio when the duration is unknown', () => {
    expect(readProgress({ progress: 0.42, time: 0 }, undefined).ratio).toBeCloseTo(0.42);
  });

  it('refuses the ratio when even that is nonsense', () => {
    // Two-input concat overshoots to nearly 2; lavfi sources go negative.
    expect(readProgress({ progress: 1.998, time: Number.NaN }, undefined).ratio).toBeUndefined();
    expect(readProgress({ progress: -0.5, time: Number.NaN }, undefined).ratio).toBeUndefined();
  });

  it('ignores an AV_NOPTS_VALUE leak instead of showing it', () => {
    const reading = readProgress({ progress: 461168601842.7, time: 4.6e18 }, 6);
    expect(reading.outTimeSeconds).toBeUndefined();
    expect(reading.ratio).toBeUndefined();
  });
});

describe('ProgressTracker', () => {
  it('never goes backwards', () => {
    const tracker = new ProgressTracker(10);
    expect(tracker.push({ progress: 0, time: 5_000_000 }).ratio).toBeCloseTo(0.5);
    // A trim caps its ratio and then snaps; a dip must not reach the UI.
    expect(tracker.push({ progress: 0, time: 1_000_000 }).ratio).toBeCloseTo(0.5);
  });

  it('holds the last good value through a bad event', () => {
    const tracker = new ProgressTracker(10);
    tracker.push({ progress: 0, time: 4_000_000 });
    const held = tracker.push({ progress: Number.NaN, time: Number.NaN });
    expect(held.ratio).toBeCloseTo(0.4);
    expect(held.outTimeSeconds).toBeCloseTo(4);
  });

  it('lands on full when the job ends', () => {
    const tracker = new ProgressTracker(10);
    tracker.push({ progress: 0, time: 2_000_000 });
    expect(tracker.complete().ratio).toBe(1);
  });
});
