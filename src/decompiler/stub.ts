import type { Decompiler } from '../ir/types';

/**
 * Plug-in point for the v2 decompiler. v1 ships no decompiler implementation.
 * The planned backend is Ghidra's C++ decompiler compiled with Emscripten.
 */
export const unimplementedDecompiler: Decompiler = {
  id: 'ghidra-decompiler',
  decompile() {
    return Promise.reject(new Error('Decompilation is not part of Webdra v1.'));
  },
};
