import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/data/tools.js';

const port = 4186;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* Wait for server. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('.directory-item').last().waitFor();
  assert.equal(await page.locator('.directory-item').count(), TOOLS.length);
  await page.screenshot({ path: join(tmpdir(), 'createpdf-dark-desktop.png') });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.screenshot({ path: join(tmpdir(), 'createpdf-light-desktop.png') });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByLabel('Filter tools').fill('merge');
  assert.ok(await page.locator('.directory-item').count() > 0);
  assert.ok(await page.locator('.directory-item').count() < TOOLS.length);
  await page.getByRole('button', { name: 'Add Merge PDFs to favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Merge PDFs from favorites', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  assert.equal(await page.locator('.directory-item').count(), 1);
  await page.getByRole('button', { name: 'Remove Merge PDFs from favorites', exact: true }).click();
  await page.getByRole('heading', { name: 'Keep your go-to tools close.' }).waitFor();
  await page.getByRole('button', { name: 'View all tools' }).click();
  await page.getByRole('button', { name: 'Security & Privacy', exact: true }).click();
  assert.equal(await page.locator('.directory-item').count(), TOOLS.filter(t => t.category === 'Security & Privacy').length);
  await page.getByLabel('Filter tools').fill('zzzz-no-tool');
  await page.getByRole('heading', { name: 'No matching tools' }).waitFor();
  await page.getByRole('button', { name: 'View all tools' }).click();
  await page.keyboard.press('Control+k');
  await page.locator('.search-modal input').fill('whiteboard');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Collaborative Whiteboard', exact: true }).waitFor();
  await page.getByRole('link', { name: 'My files', exact: true }).click();
  await page.locator('#documents').waitFor();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await page.locator('.saved-documents-drop input').setInputFiles({ name: 'workspace-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.locator('.saved-document-row strong').filter({ hasText: 'workspace-test.pdf' }).waitFor();
  await page.locator('.saved-document-row').getByRole('link', { name: 'Edit', exact: true }).click();
  await page.locator('.editor-file').filter({ hasText: 'workspace-test.pdf' }).waitFor();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'createpdf-light-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.screenshot({ path: join(tmpdir(), 'createpdf-dark-mobile.png'), fullPage: true });
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Workflows', exact: false }).click();
  await page.getByRole('heading', { name: 'PDF Workflow Builder', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Search tools', exact: true }).click();
  await page.locator('.search-modal').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.search-modal').count(), 0);
  assert.deepEqual(errors, []);
  console.log('UI checks passed: themes and persistence, search, categories, favorites, keyboard navigation, saved PDF editing, mobile navigation, and six responsive widths.');
  console.log(`Screenshots: ${tmpdir()}\\createpdf-{light,dark}-{desktop,mobile}.png`);
} finally {
  await browser?.close();
  server.kill();
}
