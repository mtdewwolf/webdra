import type { BasicBlockIR, InstructionIR } from '../ir/types';

export function buildCfg(instructions: InstructionIR[]): BasicBlockIR[] {
  if (!instructions.length) return [];
  const byAddress = new Map(instructions.map((instruction) => [instruction.address, instruction]));
  const leaders = new Set<number>([instructions[0]?.address ?? 0]);
  for (const instruction of instructions) {
    const next = instruction.address + instruction.size;
    if (instruction.flow === 'cjump') {
      if (instruction.target !== null) leaders.add(instruction.target);
      if (byAddress.has(next)) leaders.add(next);
    } else if (instruction.flow === 'jump' && instruction.target !== null) {
      leaders.add(instruction.target);
    }
  }
  const ordered = [...leaders].filter((address) => byAddress.has(address)).sort((a, b) => a - b);
  const blocks: BasicBlockIR[] = [];
  for (const start of ordered) {
    const addresses: number[] = [];
    let cursor = start;
    while (byAddress.has(cursor)) {
      if (cursor !== start && leaders.has(cursor)) break;
      const instruction = byAddress.get(cursor);
      if (!instruction) break;
      addresses.push(cursor);
      const next = cursor + instruction.size;
      if (instruction.flow === 'jump' || instruction.flow === 'ret' || instruction.flow === 'cjump') {
        cursor = next;
        break;
      }
      cursor = next;
    }
    if (!addresses.length) continue;
    const last = byAddress.get(addresses[addresses.length - 1] ?? start);
    if (!last) continue;
    const successors: BasicBlockIR['successors'] = [];
    if (last.flow === 'cjump') {
      if (last.target !== null && byAddress.has(last.target)) successors.push({ address: last.target, kind: 'taken' });
      const fall = last.address + last.size;
      if (byAddress.has(fall)) successors.push({ address: fall, kind: 'fallthrough' });
    } else if (last.flow === 'jump') {
      if (last.target !== null && byAddress.has(last.target)) successors.push({ address: last.target, kind: 'taken' });
    } else if (last.flow !== 'ret') {
      const fall = last.address + last.size;
      if (byAddress.has(fall)) successors.push({ address: fall, kind: 'fallthrough' });
    }
    blocks.push({ address: start, end: last.address + last.size, instructionAddresses: addresses, successors });
  }
  return blocks;
}
