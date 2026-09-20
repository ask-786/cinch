import { describe, expect, it } from 'vitest';
import { explainFailure, lastUsefulLine } from './errors';

describe('explainFailure', () => {
  it('recognises the out-of-memory death, which is the common one', () => {
    const result = explainFailure({
      logs: ['frame= 1200 fps=30', 'Cannot enlarge memory arrays to size 2147483648 bytes'],
    });
    expect(result.kind).toBe('memory');
    expect(result.hint).toMatch(/resolution/i);
  });

  it('reads an abort from the WASM heap as memory too', () => {
    expect(explainFailure({ error: new Error('memory access out of bounds') }).kind).toBe('memory');
  });

  it('names a missing encoder rather than quoting it', () => {
    const result = explainFailure({ logs: ["Unknown encoder 'libfdk_aac'"] });
    expect(result.kind).toBe('unsupported-codec');
    expect(result.title).not.toContain('libfdk_aac');
  });

  it('explains a codec the container cannot hold', () => {
    const result = explainFailure({
      logs: ['[webm @ 0x1] Could not find tag for codec aac in stream #1'],
    });
    expect(result.kind).toBe('container-mismatch');
  });

  it('explains an empty output', () => {
    const result = explainFailure({
      logs: ['Output file #0 does not contain any stream'],
    });
    expect(result.kind).toBe('no-stream');
  });

  it('explains a file FFmpeg could not parse', () => {
    expect(explainFailure({ logs: ['moov atom not found'] }).kind).toBe('invalid-input');
  });

  it('recognises the MT core’s poisoned-instance throw', () => {
    const result = explainFailure({
      error: new TypeError("Cannot read properties of undefined (reading 'startsWith')"),
    });
    expect(result.kind).toBe('core-crash');
    expect(result.hint).toMatch(/again/i);
  });

  it('puts memory first when a crash prints both', () => {
    const result = explainFailure({
      logs: ['Cannot enlarge memory arrays', 'RuntimeError: abort(OOM)'],
    });
    expect(result.kind).toBe('memory');
  });

  it('explains a core that never downloaded', () => {
    const result = explainFailure({ error: new Error('Failed to fetch') });
    expect(result.kind).toBe('load-failed');
  });

  it('falls back to the last thing FFmpeg actually said', () => {
    const result = explainFailure({
      exitCode: 1,
      logs: ['frame= 10 fps=2', 'Conversion failed!', 'size=       0kB'],
    });
    expect(result.kind).toBe('unknown');
    expect(result.detail).toBe('Conversion failed!');
  });

  it('mentions the exit code when the log says nothing', () => {
    const result = explainFailure({ exitCode: 69, logs: ['frame= 10 fps=2'] });
    expect(result.detail).toContain('69');
  });
});

describe('lastUsefulLine', () => {
  it('skips the progress counters and the banner', () => {
    const logs = [
      'ffmpeg version 5.1.4',
      'built with emcc',
      'configuration: --enable-gpl',
      'Invalid data found when processing input',
      'frame=  100 fps=25 q=28.0',
      'size=    1024kB time=00:00:04.00',
    ];
    expect(lastUsefulLine(logs)).toBe('Invalid data found when processing input');
  });

  it('returns nothing when there is nothing to return', () => {
    expect(lastUsefulLine([])).toBeUndefined();
    expect(lastUsefulLine(['   ', 'frame= 1'])).toBeUndefined();
  });
});
