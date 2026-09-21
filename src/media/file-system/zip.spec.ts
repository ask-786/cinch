import { describe, expect, it } from 'vitest';
import { crc32, zipBlobs } from './zip';

const text = (value: string) => new TextEncoder().encode(value);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zipBlobs', () => {
  const when = new Date(2026, 8, 21, 10, 30, 0);

  it('lays out stored entries and a directory a reader can walk', async () => {
    const zip = await zipBlobs(
      [
        { name: 'a-0001.jpg', blob: new Blob([text('hello')]) },
        { name: 'b-0002.jpg', blob: new Blob([text('world!')]) },
      ],
      when,
    );
    const view = new DataView(await zip.arrayBuffer());

    expect(zip.type).toBe('application/zip');
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // Stored, with the first entry's CRC and size in its local header.
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(14, true)).toBe(crc32(text('hello')));
    expect(view.getUint32(18, true)).toBe(5);

    // The end record sits in the last 22 bytes and points at the directory.
    const end = zip.size - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const directory = view.getUint32(end + 16, true);
    expect(view.getUint32(directory, true)).toBe(0x02014b50);

    // The second directory record points back at the second local header.
    const second = directory + 46 + 'a-0001.jpg'.length;
    const offset = view.getUint32(second + 42, true);
    expect(offset).toBe(30 + 'a-0001.jpg'.length + 5);
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
  });

  it('writes an empty but valid archive for no entries', async () => {
    const zip = await zipBlobs([], when);
    expect(zip.size).toBe(22);
  });
});
