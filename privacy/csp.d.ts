export const sharedDirectives: [string, string[]][];
export function serializeCsp(directives: [string, string[]][]): string;
export const metaCsp: string;
export const headerCsp: string;
export const extraHeaders: Record<string, string>;
export function renderHeadersFile(): string;
