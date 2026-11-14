import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 4;
      const nx = x / size;
      const ny = y / size;
      const bar = (nx > 0.18 && nx < 0.28 && ny > 0.2 && ny < 0.8) || (nx > 0.42 && nx < 0.52 && ny > 0.35 && ny < 0.8) || (nx > 0.66 && nx < 0.76 && ny > 0.2 && ny < 0.8);
      const mark = Math.abs(ny - (0.72 - Math.abs(nx - 0.5))) < 0.03 && nx > 0.2 && nx < 0.8;
      const on = bar || mark;
      raw[pixel] = on ? 0xe6 : 0x14;
      raw[pixel + 1] = on ? 0x9f : 0x16;
      raw[pixel + 2] = on ? 0x00 : 0x1a;
      raw[pixel + 3] = 255;
    }
  }
  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', ihdr(size)), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function ihdr(size) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(size, 0);
  buffer.writeUInt32BE(size, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  return buffer;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc;
}

writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
console.log('wrote icons');
