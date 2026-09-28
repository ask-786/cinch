import { describe, expect, it } from 'vitest';
import { displaySize, mergeInfo, type MediaInfo } from './media-info';

const info = (overrides: Partial<MediaInfo>): MediaInfo => ({
  source: 'ffprobe',
  kind: 'video',
  width: 1280,
  height: 720,
  ...overrides,
});

describe('displaySize', () => {
  it('is the stored size when the picture is upright', () => {
    expect(displaySize(info({}))).toEqual({ width: 1280, height: 720 });
    expect(displaySize(info({ rotation: 180 }))).toEqual({ width: 1280, height: 720 });
  });

  it('turns the size on its side for a video held upright', () => {
    expect(displaySize(info({ rotation: 90 }))).toEqual({ width: 720, height: 1280 });
    expect(displaySize(info({ rotation: -90 }))).toEqual({ width: 720, height: 1280 });
    expect(displaySize(info({ rotation: 270 }))).toEqual({ width: 720, height: 1280 });
  });

  it('knows nothing until something has measured the picture', () => {
    expect(displaySize(info({ width: undefined }))).toBeUndefined();
    expect(displaySize(undefined)).toBeUndefined();
  });
});

describe('mergeInfo', () => {
  it('takes the rotation only along with the size it applies to', () => {
    // The browser already reports a phone video upright; a rotation from
    // ffprobe must not turn that size on its side a second time.
    const native: MediaInfo = { source: 'native', kind: 'video', width: 720, height: 1280 };
    const probed: MediaInfo = { source: 'ffprobe', kind: 'video', rotation: 90 };
    expect(displaySize(mergeInfo(native, probed))).toEqual({ width: 720, height: 1280 });

    const sized: MediaInfo = { ...probed, width: 1280, height: 720 };
    expect(displaySize(mergeInfo(native, sized))).toEqual({ width: 720, height: 1280 });
  });
});
