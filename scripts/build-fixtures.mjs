import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = 'tests/fixtures/bins';
mkdirSync(out, { recursive: true });

execFileSync('gcc', ['-O0', '-fno-omit-frame-pointer', '-o', `${out}/elf64-x86_64`, 'fixtures/src/sample.c'], { stdio: 'inherit' });

execFileSync('clang', ['-target', 'aarch64-linux-gnu', '-c', '-o', '/tmp/webdra-arm64.o', 'fixtures/src/arm64.s'], { stdio: 'inherit' });
const armObject = extractObject('/tmp/webdra-arm64.o');
const armText = applyAarch64Call26(armObject);
const armRodata = armObject.sections.get('.rodata');
writeFileSync(`${out}/elf64-arm64`, buildElf64({ machine: 183, code: armText, rodata: armRodata, entrySymbol: '_start' }));

execFileSync('clang', ['-target', 'x86_64-apple-macosx', '-c', '-o', `${out}/macho-x86_64`, 'fixtures/src/macho-x64.s'], { stdio: 'inherit' });
execFileSync('clang', ['-target', 'arm64-apple-macosx', '-c', '-o', `${out}/macho-arm64`, 'fixtures/src/macho-arm64.s'], { stdio: 'inherit' });
writeFileSync(`${out}/macho-fat`, fatMacho([
  readFileSync(`${out}/macho-x86_64`),
  readFileSync(`${out}/macho-arm64`),
]));

writeFileSync(`${out}/pe64-x86_64`, buildPe64());
writeFileSync(`${out}/elf32-x86`, buildElf32());
const elf = readFileSync(`${out}/elf64-x86_64`);
writeFileSync(`${out}/elf64-truncated`, elf.subarray(0, 32));
writeFileSync(`${out}/elf64-xss`, buildNamedElf('<img src=x onerror=...>'));
console.log('fixtures ready');

function buildElf64({ machine, code, rodata, entrySymbol }) {
  const shstr = concat(Buffer.from('\0.text\0.rodata\0.shstrtab\0.strtab\0.symtab\0'));
  const names = { '': 0, '.text': 1, '.rodata': 7, '.shstrtab': 15, '.strtab': 25, '.symtab': 33 };
  const strtab = Buffer.concat([
    Buffer.from([0]),
    Buffer.from('main\0'),
    Buffer.from('_start\0'),
    Buffer.from('msg\0'),
  ]);
  const strOff = { main: 1, _start: 6, msg: 13 };
  const headerSize = 64;
  const phoff = 64;
  const phsize = 56;
  const codeOff = align(phoff + phsize, 16);
  const roOff = align(codeOff + code.length, 16);
  const shstrOff = roOff + rodata.length;
  const strtabOff = shstrOff + shstr.length;
  const symOff = align(strtabOff + strtab.length, 8);
  const symCount = 4;
  const symSize = symCount * 24;
  const shoff = align(symOff + symSize, 8);
  const shnum = 6;
  const fileSize = shoff + shnum * 64;
  const buffer = Buffer.alloc(fileSize);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1);
  buffer[4] = 2;
  buffer[5] = 1;
  buffer[6] = 1;
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(machine, 18);
  buffer.writeUInt32LE(1, 20);
  const base = 0x400000;
  const codeVa = base + codeOff;
  const roVa = base + roOff;
  const entry = entrySymbol === '_start' ? codeVa + 8 : codeVa;
  buffer.writeBigUInt64LE(BigInt(entry), 24);
  buffer.writeBigUInt64LE(BigInt(phoff), 32);
  buffer.writeBigUInt64LE(BigInt(shoff), 40);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(1, 56);
  buffer.writeUInt16LE(64, 58);
  buffer.writeUInt16LE(shnum, 60);
  buffer.writeUInt16LE(3, 62);
  writePhdr64(buffer, phoff, { offset: 0, va: base, fileSize, memSize: fileSize, flags: 5 });
  code.copy(buffer, codeOff);
  rodata.copy(buffer, roOff);
  shstr.copy(buffer, shstrOff);
  strtab.copy(buffer, strtabOff);
  writeSym64(buffer, symOff + 24, { name: strOff.main, info: 0x12, shndx: 1, value: codeVa, size: 8 });
  writeSym64(buffer, symOff + 48, { name: strOff._start, info: 0x12, shndx: 1, value: codeVa + 8, size: 12 });
  writeSym64(buffer, symOff + 72, { name: strOff.msg, info: 0x11, shndx: 2, value: roVa, size: rodata.length });
  const sections = [
    {},
    { name: names['.text'], type: 1, flags: 6, addr: codeVa, off: codeOff, size: code.length },
    { name: names['.rodata'], type: 1, flags: 2, addr: roVa, off: roOff, size: rodata.length },
    { name: names['.shstrtab'], type: 3, flags: 0, addr: 0, off: shstrOff, size: shstr.length },
    { name: names['.strtab'], type: 3, flags: 0, addr: 0, off: strtabOff, size: strtab.length },
    { name: names['.symtab'], type: 2, flags: 0, addr: 0, off: symOff, size: symSize, link: 4, info: 1, entsize: 24 },
  ];
  sections.forEach((section, index) => writeShdr64(buffer, shoff + index * 64, section));
  return buffer;
}

function buildNamedElf(symbolName) {
  const code = Buffer.from([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3]);
  const shstr = Buffer.from('\0.text\0.payload\0.shstrtab\0.strtab\0.symtab\0');
  const strtab = Buffer.concat([Buffer.from([0]), Buffer.from(`${symbolName}\0`)]);
  const codeOff = 128;
  const shstrOff = codeOff + code.length;
  const strOff = shstrOff + shstr.length;
  const symOff = align(strOff + strtab.length, 8);
  const shoff = align(symOff + 48, 8);
  const fileSize = shoff + 5 * 64;
  const buffer = Buffer.alloc(fileSize);
  const base = 0x400000;
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 2;
  buffer[5] = 1;
  buffer[6] = 1;
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(62, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeBigUInt64LE(BigInt(base + codeOff), 24);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeBigUInt64LE(BigInt(shoff), 40);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(1, 56);
  buffer.writeUInt16LE(64, 58);
  buffer.writeUInt16LE(5, 60);
  buffer.writeUInt16LE(2, 62);
  writePhdr64(buffer, 64, { offset: 0, va: base, fileSize, memSize: fileSize, flags: 5 });
  code.copy(buffer, codeOff);
  shstr.copy(buffer, shstrOff);
  strtab.copy(buffer, strOff);
  writeSym64(buffer, symOff + 24, { name: 1, info: 0x12, shndx: 1, value: base + codeOff, size: code.length });
  const sections = [
    {},
    { name: 1, type: 1, flags: 6, addr: base + codeOff, off: codeOff, size: code.length },
    { name: 16, type: 3, flags: 0, addr: 0, off: shstrOff, size: shstr.length },
    { name: 26, type: 3, flags: 0, addr: 0, off: strOff, size: strtab.length },
    { name: 34, type: 2, flags: 0, addr: 0, off: symOff, size: 48, link: 3, info: 1, entsize: 24 },
  ];
  sections.forEach((section, index) => writeShdr64(buffer, shoff + index * 64, section));
  return buffer;
}

function buildElf32() {
  const code = Buffer.from([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3]);
  const shstr = Buffer.from('\0.text\0.shstrtab\0.strtab\0.symtab\0');
  const strtab = Buffer.from('\0main\0');
  const header = 52;
  const phoff = 52;
  const codeOff = 128;
  const shstrOff = codeOff + code.length;
  const strOff = shstrOff + shstr.length;
  const symOff = align(strOff + strtab.length, 4);
  const shoff = align(symOff + 32, 4);
  const fileSize = shoff + 5 * 40;
  const buffer = Buffer.alloc(fileSize);
  const base = 0x08048000;
  buffer[0] = 0x7f;
  buffer.write('ELF', 1);
  buffer[4] = 1;
  buffer[5] = 1;
  buffer[6] = 1;
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(3, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(base + codeOff, 24);
  buffer.writeUInt32LE(phoff, 28);
  buffer.writeUInt32LE(shoff, 32);
  buffer.writeUInt16LE(52, 40);
  buffer.writeUInt16LE(32, 42);
  buffer.writeUInt16LE(1, 44);
  buffer.writeUInt16LE(40, 46);
  buffer.writeUInt16LE(5, 48);
  buffer.writeUInt16LE(2, 50);
  buffer.writeUInt32LE(1, phoff);
  buffer.writeUInt32LE(0, phoff + 4);
  buffer.writeUInt32LE(base, phoff + 8);
  buffer.writeUInt32LE(base, phoff + 12);
  buffer.writeUInt32LE(fileSize, phoff + 16);
  buffer.writeUInt32LE(fileSize, phoff + 20);
  buffer.writeUInt32LE(5, phoff + 24);
  buffer.writeUInt32LE(0x1000, phoff + 28);
  code.copy(buffer, codeOff);
  shstr.copy(buffer, shstrOff);
  strtab.copy(buffer, strOff);
  const sym = symOff + 16;
  buffer.writeUInt32LE(1, sym);
  buffer.writeUInt32LE(base + codeOff, sym + 4);
  buffer.writeUInt32LE(6, sym + 8);
  buffer[sym + 12] = 0x12;
  buffer.writeUInt16LE(1, sym + 14);
  const sections = [
    {},
    { name: 1, type: 1, flags: 6, addr: base + codeOff, off: codeOff, size: code.length },
    { name: 7, type: 3, flags: 0, addr: 0, off: shstrOff, size: shstr.length },
    { name: 17, type: 3, flags: 0, addr: 0, off: strOff, size: strtab.length },
    { name: 25, type: 2, flags: 0, addr: 0, off: symOff, size: 32, link: 3, info: 1, entsize: 16 },
  ];
  sections.forEach((section, index) => {
    const at = shoff + index * 40;
    buffer.writeUInt32LE(section.name ?? 0, at);
    buffer.writeUInt32LE(section.type ?? 0, at + 4);
    buffer.writeUInt32LE(section.flags ?? 0, at + 8);
    buffer.writeUInt32LE(section.addr ?? 0, at + 12);
    buffer.writeUInt32LE(section.off ?? 0, at + 16);
    buffer.writeUInt32LE(section.size ?? 0, at + 20);
    buffer.writeUInt32LE(section.link ?? 0, at + 24);
    buffer.writeUInt32LE(section.info ?? 0, at + 28);
    buffer.writeUInt32LE(1, at + 32);
    buffer.writeUInt32LE(section.entsize ?? 0, at + 36);
  });
  void header;
  return buffer;
}

function buildPe64() {
  const fileAlign = 0x200;
  const sectionAlign = 0x1000;
  const lfanew = 0x80;
  const optionalSize = 240;
  const sectionCount = 2;
  const sectionTable = lfanew + 4 + 20 + optionalSize;
  const headersSize = align(sectionTable + sectionCount * 40, fileAlign);
  const textRva = sectionAlign;
  const rdataRva = sectionAlign * 2;
  const code = Buffer.from([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3]);
  const rdata = Buffer.alloc(0x200);
  Buffer.from('webdra-fixture-string\0').copy(rdata, 0x00);
  Buffer.from('webdra.exe\0').copy(rdata, 0x20);
  Buffer.from('main\0').copy(rdata, 0x40);
  Buffer.from('KERNEL32.dll\0').copy(rdata, 0x50);
  rdata.writeUInt16LE(0, 0x70);
  Buffer.from('ExitProcess\0').copy(rdata, 0x72);
  rdata.writeUInt32LE(rdataRva + 0x20, 0x9c);
  rdata.writeUInt32LE(1, 0xa0);
  rdata.writeUInt32LE(1, 0xa4);
  rdata.writeUInt32LE(1, 0xa8);
  rdata.writeUInt32LE(rdataRva + 0xb8, 0xac);
  rdata.writeUInt32LE(rdataRva + 0xbc, 0xb0);
  rdata.writeUInt32LE(rdataRva + 0xc0, 0xb4);
  rdata.writeUInt32LE(textRva, 0xb8);
  rdata.writeUInt32LE(rdataRva + 0x40, 0xbc);
  rdata.writeUInt16LE(0, 0xc0);
  rdata.writeUInt32LE(rdataRva + 0x100, 0xd0);
  rdata.writeUInt32LE(rdataRva + 0x50, 0xdc);
  rdata.writeUInt32LE(rdataRva + 0x110, 0xe0);
  rdata.writeBigUInt64LE(BigInt(rdataRva + 0x70), 0x100);
  rdata.writeBigUInt64LE(BigInt(rdataRva + 0x70), 0x110);

  const fileSize = headersSize + fileAlign * 2;
  const buffer = Buffer.alloc(fileSize);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(lfanew, 0x3c);
  buffer.writeUInt32LE(0x4550, lfanew);
  const coff = lfanew + 4;
  buffer.writeUInt16LE(0x8664, coff);
  buffer.writeUInt16LE(sectionCount, coff + 2);
  buffer.writeUInt16LE(optionalSize, coff + 16);
  buffer.writeUInt16LE(0x22, coff + 18);
  const opt = coff + 20;
  buffer.writeUInt16LE(0x20b, opt);
  buffer.writeUInt32LE(code.length, opt + 4);
  buffer.writeUInt32LE(rdata.length, opt + 8);
  buffer.writeUInt32LE(textRva, opt + 16);
  buffer.writeUInt32LE(textRva, opt + 20);
  buffer.writeBigUInt64LE(0x140000000n, opt + 24);
  buffer.writeUInt32LE(sectionAlign, opt + 32);
  buffer.writeUInt32LE(fileAlign, opt + 36);
  buffer.writeUInt16LE(6, opt + 40);
  buffer.writeUInt16LE(6, opt + 48);
  buffer.writeUInt32LE(sectionAlign * 3, opt + 56);
  buffer.writeUInt32LE(headersSize, opt + 60);
  buffer.writeUInt16LE(3, opt + 68);
  buffer.writeBigUInt64LE(0x100000n, opt + 72);
  buffer.writeBigUInt64LE(0x1000n, opt + 80);
  buffer.writeBigUInt64LE(0x100000n, opt + 88);
  buffer.writeBigUInt64LE(0x1000n, opt + 96);
  buffer.writeUInt32LE(16, opt + 108);
  buffer.writeUInt32LE(rdataRva + 0x90, opt + 112);
  buffer.writeUInt32LE(0x40, opt + 116);
  buffer.writeUInt32LE(rdataRva + 0xd0, opt + 120);
  buffer.writeUInt32LE(0x28, opt + 124);
  writeSection(buffer, sectionTable, '.text', code.length, textRva, code.length, headersSize, 0x60000020);
  writeSection(buffer, sectionTable + 40, '.rdata', rdata.length, rdataRva, rdata.length, headersSize + fileAlign, 0x40000040);
  code.copy(buffer, headersSize);
  rdata.copy(buffer, headersSize + fileAlign);
  return buffer;
}

function writeSection(buffer, at, name, virtualSize, virtualAddress, rawSize, rawPointer, characteristics) {
  buffer.write(name, at, 'ascii');
  buffer.writeUInt32LE(virtualSize, at + 8);
  buffer.writeUInt32LE(virtualAddress, at + 12);
  buffer.writeUInt32LE(rawSize, at + 16);
  buffer.writeUInt32LE(rawPointer, at + 20);
  buffer.writeUInt32LE(characteristics, at + 36);
}

function fatMacho(slices) {
  const header = 8 + slices.length * 20;
  let cursor = align(header, 8);
  const placed = slices.map((slice) => {
    const offset = cursor;
    cursor = align(offset + slice.length, 8);
    return { slice, offset };
  });
  const buffer = Buffer.alloc(cursor);
  buffer.writeUInt32BE(0xcafebabe, 0);
  buffer.writeUInt32BE(slices.length, 4);
  placed.forEach((item, index) => {
    const at = 8 + index * 20;
    const cpu = index === 0 ? 0x01000007 : 0x0100000c;
    buffer.writeInt32BE(cpu, at);
    buffer.writeInt32BE(0, at + 4);
    buffer.writeUInt32BE(item.offset, at + 8);
    buffer.writeUInt32BE(item.slice.length, at + 12);
    buffer.writeUInt32BE(3, at + 16);
    item.slice.copy(buffer, item.offset);
  });
  return buffer;
}

function writePhdr64(buffer, at, program) {
  buffer.writeUInt32LE(1, at);
  buffer.writeUInt32LE(program.flags, at + 4);
  buffer.writeBigUInt64LE(BigInt(program.offset), at + 8);
  buffer.writeBigUInt64LE(BigInt(program.va), at + 16);
  buffer.writeBigUInt64LE(BigInt(program.va), at + 24);
  buffer.writeBigUInt64LE(BigInt(program.fileSize), at + 32);
  buffer.writeBigUInt64LE(BigInt(program.memSize), at + 40);
  buffer.writeBigUInt64LE(0x1000n, at + 48);
}

function writeShdr64(buffer, at, section) {
  buffer.writeUInt32LE(section.name ?? 0, at);
  buffer.writeUInt32LE(section.type ?? 0, at + 4);
  buffer.writeBigUInt64LE(BigInt(section.flags ?? 0), at + 8);
  buffer.writeBigUInt64LE(BigInt(section.addr ?? 0), at + 16);
  buffer.writeBigUInt64LE(BigInt(section.off ?? 0), at + 24);
  buffer.writeBigUInt64LE(BigInt(section.size ?? 0), at + 32);
  buffer.writeUInt32LE(section.link ?? 0, at + 40);
  buffer.writeUInt32LE(section.info ?? 0, at + 44);
  buffer.writeBigUInt64LE(1n, at + 48);
  buffer.writeBigUInt64LE(BigInt(section.entsize ?? 0), at + 56);
}

function writeSym64(buffer, at, symbol) {
  buffer.writeUInt32LE(symbol.name, at);
  buffer[at + 4] = symbol.info;
  buffer.writeUInt16LE(symbol.shndx, at + 6);
  buffer.writeBigUInt64LE(BigInt(symbol.value), at + 8);
  buffer.writeBigUInt64LE(BigInt(symbol.size), at + 16);
}

function extractObject(file) {
  const buf = readFileSync(file);
  const shoff = Number(buf.readBigUInt64LE(40));
  const shentsize = buf.readUInt16LE(58);
  const shnum = buf.readUInt16LE(60);
  const shstrndx = buf.readUInt16LE(62);
  const headers = [];
  for (let index = 0; index < shnum; index += 1) {
    const at = shoff + index * shentsize;
    headers.push({
      nameOff: buf.readUInt32LE(at),
      type: buf.readUInt32LE(at + 4),
      offset: Number(buf.readBigUInt64LE(at + 24)),
      size: Number(buf.readBigUInt64LE(at + 32)),
      link: buf.readUInt32LE(at + 40),
    });
  }
  const str = headers[shstrndx];
  const nameOf = (header) => {
    let cursor = str.offset + header.nameOff;
    let name = '';
    while (buf[cursor] !== 0) {
      name += String.fromCharCode(buf[cursor]);
      cursor += 1;
    }
    return name;
  };
  const sections = new Map(headers.map((header) => [nameOf(header), Buffer.from(buf.subarray(header.offset, header.offset + header.size))]));
  return { buf, headers, sections, nameOf };
}

function applyAarch64Call26(object) {
  const code = Buffer.from(object.sections.get('.text'));
  const relas = object.sections.get('.rela.text');
  const symbols = object.sections.get('.symtab');
  if (!relas || !symbols) return code;
  for (let index = 0; index < relas.length; index += 24) {
    const offset = Number(relas.readBigUInt64LE(index));
    const info = relas.readBigUInt64LE(index + 8);
    const addend = Number(relas.readBigInt64LE(index + 16));
    const type = Number(info & 0xffffffffn);
    const symbolIndex = Number(info >> 32n);
    if (type !== 283) continue;
    const symbolValue = Number(symbols.readBigUInt64LE(symbolIndex * 24 + 8));
    const immediate = (symbolValue + addend - offset) >> 2;
    const word = 0x94000000 | (immediate & 0x03ffffff);
    code.writeUInt32LE(word >>> 0, offset);
  }
  return code;
}

function align(value, boundary) {
  return (value + boundary - 1) & ~(boundary - 1);
}

function concat(buffer) {
  return buffer;
}
