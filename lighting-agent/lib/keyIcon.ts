import { crc32, deflateSync } from 'node:zlib';

// A Stream Deck key icon (docs/lighting/STREAM_DECK.md): a 144x144 PNG (the XL's key at 2x) in the key's color with a
// darker edge, so the color shows what the key does. The key's text is Stream Deck's own Title. No npm packages: the
// PNG is written by hand (signature, IHDR, one IDAT, IEND).

export const KEY_ICON_SIZE = 144;
const EDGE = 8;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function keyIconPng(hex: string, size = KEY_ICON_SIZE): Buffer {
  const m = hex.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`Not an RRGGBB color: ${hex}`);
  const fill = [1, 2, 3].map((i) => parseInt(m[i], 16));
  const edge = fill.map((c) => Math.round(c * 0.55));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const onEdge = x < EDGE || y < EDGE || x >= size - EDGE || y >= size - EDGE;
      const c = onEdge ? edge : fill;
      raw.set(c, row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
