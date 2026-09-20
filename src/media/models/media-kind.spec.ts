import { describe, expect, it } from 'vitest';
import { classify, extensionOf } from './media-kind';

describe('classify', () => {
  it('trusts the extension over the MIME type', () => {
    // Windows reports .mkv as video/x-matroska or nothing at all.
    expect(classify('holiday.mkv', '')).toBe('video');
    expect(classify('take-2.MOV', 'application/octet-stream')).toBe('video');
    expect(classify('voice.m4a', '')).toBe('audio');
    expect(classify('cover.webp', '')).toBe('image');
    expect(classify('episode.srt', '')).toBe('subtitle');
  });

  it('falls back to the MIME type for extensions it has never seen', () => {
    expect(classify('recording', 'audio/ogg')).toBe('audio');
    expect(classify('clip.mystery', 'video/mp4')).toBe('video');
  });

  it('returns undefined for things Cinch should not open', () => {
    expect(classify('taxes.pdf', 'application/pdf')).toBeUndefined();
    expect(classify('notes.txt', 'text/plain')).toBeUndefined();
    expect(classify('archive.zip', '')).toBeUndefined();
  });
});

describe('extensionOf', () => {
  it('takes the last segment, lowercased', () => {
    expect(extensionOf('a.b.MP4')).toBe('mp4');
  });

  it('ignores dotfiles and bare names', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('README')).toBe('');
  });
});
