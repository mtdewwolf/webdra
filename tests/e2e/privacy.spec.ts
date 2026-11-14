import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const basePath = process.env.BASE_PATH ?? '/';

const leaks: string[] = [];

test.beforeEach(async ({ context, baseURL }) => {
  leaks.length = 0;
  const allowed = builtRequestPaths(path.resolve('dist'), basePath);
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
  await context.addInitScript(() => {
    const record = window as Window & { __cspViolations?: string[] };
    record.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      record.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.protocol === 'data:' || url.protocol === 'blob:' || !allowed.has(url.pathname)) {
      leaks.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || !allowed.has(url.pathname)) leaks.push(request.url());
  });
  });

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as Window & { __cspViolations?: string[] }).__cspViolations ?? []).catch(() => []);
  const consoleHits = leaks.filter((item) => item.toLowerCase().includes('violates'));
  expect(violations).toEqual([]);
  expect(consoleHits).toEqual([]);
  expect(leaks).toEqual([]);
});

test('analyzes ELF, PE, and Mach-O without leaving the built file list', async ({ page }) => {
  const messages: string[] = [];
  page.on('websocket', (socket) => leaks.push(socket.url()));
  page.on('console', (message) => {
    messages.push(message.text());
    if (message.text().toLowerCase().includes('violates') || message.text().includes('Content Security Policy')) leaks.push(message.text());
  });

  const response = await page.goto(basePath === '/' ? '/' : basePath);
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy'] ?? '').toContain("default-src 'none'");
  expect(headers['content-security-policy'] ?? '').toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy'] ?? '').toContain("worker-src 'self'");
  expect(headers['content-security-policy'] ?? '').not.toContain('blob:');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');

  await expect(page).toHaveTitle('Webdra');
  await expect(page.getByText('Data stays on this device')).toBeVisible();
  await page.locator('#open-file').setInputFiles('tests/fixtures/bins/elf64-x86_64');
  await expect(page.getByRole('button', { name: /main/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('disassembly')).toContainText(/ret|mov|call/);
  for (const fixture of ['pe64-x86_64', 'macho-x86_64', 'macho-fat']) {
    await page.locator('#open-file').setInputFiles(`tests/fixtures/bins/${fixture}`);
    await expect(page.getByTestId('disassembly')).toContainText(/mov|ret/, { timeout: 30_000 });
  }
  const url = new URL(page.url());
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
  expect(await page.title()).toBe('Webdra');
  expect(messages.join('\n')).not.toContain('webdra-fixture-string');

  await page.getByRole('tab', { name: 'Strings' }).click();
  await expect(page.getByTestId('strings')).toContainText('webdra-fixture-string');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await expect(page.getByTestId('cfg')).toBeVisible();
  expect(leaks).toEqual([]);
  await page.screenshot({ path: 'test-results/webdra-listing.png', fullPage: true });
});

function builtRequestPaths(dist: string, base: string): Set<string> {
  const prefix = !base || base === '/' ? '' : base.replace(/\/$/, '');
  const paths = new Set<string>();
  for (const relative of walk(dist)) {
    paths.add(`${prefix}/${relative}`.replace(/\/{2,}/g, '/'));
  }
  paths.add(prefix ? `${prefix}/` : '/');
  return paths;
}

function walk(directory: string, root = directory): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, root));
    else found.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return found;
}
