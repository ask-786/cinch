import { describe, expect, it } from 'vitest';
import { vp8CeilingKbps, vp8Crf, vp8QualityArgs } from './vp8-output';

describe('vp8Crf', () => {
  it('runs from worst at 0 to best at 100', () => {
    expect(vp8Crf(0)).toBe(40);
    expect(vp8Crf(100)).toBe(10);
  });
});

describe('vp8CeilingKbps', () => {
  it('grows with the frame size and rate', () => {
    expect(vp8CeilingKbps({ width: 1280, height: 720, frameRate: 30 })).toBe(1935);
    expect(vp8CeilingKbps({ width: 1920, height: 1080, frameRate: 30 })).toBe(4355);
  });

  it('assumes 720p30 while the size is still being read', () => {
    expect(vp8CeilingKbps(undefined)).toBe(1935);
  });
});

describe('vp8QualityArgs', () => {
  it('pairs the CRF with a bitrate ceiling, which VP8 needs', () => {
    const args = vp8QualityArgs(60, { width: 1280, height: 720, frameRate: 30 });
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx');
    expect(args[args.indexOf('-crf') + 1]).toBe(String(vp8Crf(60)));
    expect(args[args.indexOf('-b:v') + 1]).toBe('1935k');
  });
});
