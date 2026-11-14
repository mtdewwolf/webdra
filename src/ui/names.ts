import type { FunctionSummary } from '../ir/types';
import { addressKey } from '../analysis/format';

export function displayName(address: number, functions: FunctionSummary[], renames: Record<string, string>): string {
  const renamed = renames[addressKey(address)];
  if (renamed) return renamed;
  const found = functions.find((item) => item.address === address);
  return found?.demangled || found?.name || `sub_${address.toString(16)}`;
}
