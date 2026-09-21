/**
 * A zip writer for the one job we have: bundling a run of frames or segments
 * into a single download. Stored, not deflated — the files inside are JPEGs,
 * PNGs and video, which are compressed already, so deflating would cost time
 * for nothing. No dependency, and the file bytes go into the Blob as they are.
 *
 * No zip64: the core's heap tops out at 2 GB, well inside the 4 GB limit.
 */

export interface ZipEntry {
  readonly name: string;
  readonly blob: Blob;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** 2.0: the lowest version that knows about folders and stored files. */
const VERSION = 20;
/** Bit 11: the names are UTF-8. */
const UTF8_NAMES = 0x0800;
const LIMIT = 0xffffffff;

export async function zipBlobs(entries: readonly ZipEntry[], now = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let centralSize = 0;
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(new Uint8Array(await entry.blob.arrayBuffer()));
    const size = entry.blob.size;
    if (offset + size > LIMIT) throw new RangeError('Too much to fit in one zip file.');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, CENTRAL_HEADER, true);
    record.setUint16(4, VERSION, true);
    record.setUint16(6, VERSION, true);
    record.setUint16(8, UTF8_NAMES, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, name.length, true);
    // Extra field, comment, disk number, internal and external attributes: none.
    record.setUint32(42, offset, true);

    parts.push(local.buffer, name, entry.blob);
    central.push(record.buffer, name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + size;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

let table: Uint32Array | undefined;

/** The CRC-32 every zip reader checks, IEEE polynomial. */
export function crc32(data: Uint8Array): number {
  table ??= makeTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeTable(): Uint32Array {
  const result = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    result[n] = c >>> 0;
  }
  return result;
}

/** MS-DOS packed time and date, local time, two-second precision. */
function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}
