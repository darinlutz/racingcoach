// A small ZIP writer for Download My Data (personalDataExport.ts), so the export needs no new dependency. Writes each
// entry to a file as it's added (deflated, or stored when that's smaller), so a large export never sits in memory
// whole; then the central directory. Plain ZIP (no ZIP64), so one archive is under 4 GB and 65,535 entries, which
// finish() checks. File names are UTF-8 (general purpose bit 11).
import { createWriteStream, type WriteStream } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

type Entry = { name: Buffer; crc: number; compressed: number; size: number; method: number; offset: number; time: number; date: number };

const MAX_ZIP32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

// MS-DOS time and date, as ZIP stores them (local time is meaningless for an export, so UTC)
function dosDateTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((Math.max(at.getUTCFullYear(), 1980) - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export class ZipWriter {
  private readonly out: WriteStream;
  private readonly entries: Entry[] = [];
  private offset = 0;
  private readonly names = new Set<string>();
  private readonly stamp: { time: number; date: number };

  constructor(path: string, at: Date = new Date()) {
    this.out = createWriteStream(path);
    this.stamp = dosDateTime(at);
  }

  private write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    return new Promise((resolve, reject) => {
      this.out.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }

  get bytesWritten(): number {
    return this.offset;
  }

  async add(name: string, content: string | Buffer): Promise<void> {
    // Forward slashes, no leading slash or parent references, each name once
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '..').join('/');
    if (!clean || this.names.has(clean)) throw new Error(`Bad or repeated ZIP entry name: ${name}`);
    if (this.entries.length >= MAX_ENTRIES) throw new Error('Too many entries for a ZIP archive');
    this.names.add(clean);
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const entry: Entry = {
      name: Buffer.from(clean, 'utf8'),
      crc: crc32(data),
      compressed: body.length,
      size: data.length,
      method: stored ? 0 : 8,
      offset: this.offset,
      ...this.stamp,
    };
    if (entry.offset + 30 + entry.name.length + body.length > MAX_ZIP32) throw new Error('Export too large for a ZIP archive');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.time, 10);
    header.writeUInt16LE(entry.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);
    await this.write(header);
    await this.write(entry.name);
    await this.write(body);
    this.entries.push(entry);
  }

  // Writes the central directory and closes the file; answers the archive's size
  async finish(): Promise<number> {
    const start = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4); // made by
      header.writeUInt16LE(20, 6); // needed
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(entry.offset, 42);
      await this.write(header);
      await this.write(entry.name);
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    if (this.offset > MAX_ZIP32) throw new Error('Export too large for a ZIP archive');
    await new Promise<void>((resolve, reject) => this.out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    return this.offset;
  }

  // Closes the file without finishing it, after a failure (the caller deletes it)
  abort(): void {
    this.out.destroy();
  }
}
