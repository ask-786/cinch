import { describe, expect, it } from 'vitest';
import { outputFileName } from './save';

describe('outputFileName', () => {
  it('keeps the name and swaps the extension', () => {
    expect(outputFileName('holiday.mov', 'compressed', 'mp4')).toBe('holiday-compressed.mp4');
  });

  it('survives dots in the middle and names without any', () => {
    expect(outputFileName('holiday.final.v2.mkv', 'small', 'mp4')).toBe(
      'holiday.final.v2-small.mp4',
    );
    expect(outputFileName('recording', 'small', 'mp4')).toBe('recording-small.mp4');
  });
});
