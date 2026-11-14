export function parseHeadersFile(text: string): { pattern: string; headers: Record<string, string> }[];
export function headersForPath(
  rules: { pattern: string; headers: Record<string, string> }[],
  pathname: string,
): Record<string, string>;
