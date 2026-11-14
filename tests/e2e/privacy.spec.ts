import { expect, test } from '@playwright/test';

test('analyzes a fixture without leaving the origin', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(request.url());
  });
  page.on('websocket', (socket) => external.push(socket.url()));
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));

  await page.goto('/');
  await expect(page).toHaveTitle('Webdra');
  await expect(page.getByText('Data stays on this device')).toBeVisible();
  await page.locator('#open-file').setInputFiles('tests/fixtures/bins/elf64-x86_64');
  await expect(page.getByRole('button', { name: /main/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('disassembly')).toContainText(/ret|mov|call/);
  const url = new URL(page.url());
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
  expect(await page.title()).toBe('Webdra');
  expect(external).toEqual([]);
  expect(messages.join('\n')).not.toContain('webdra-fixture-string');

  await page.getByRole('tab', { name: 'Strings' }).click();
  await expect(page.getByTestId('strings')).toContainText('webdra-fixture-string');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await expect(page.getByTestId('cfg')).toBeVisible();
  await page.screenshot({ path: 'test-results/webdra-listing.png', fullPage: true });
});
