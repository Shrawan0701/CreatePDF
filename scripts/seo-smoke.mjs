import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { APP_PATHS, getPageSeo, INDEXABLE_PATHS } from '../src/seo/metadata.js';
import { BRAND_ICONS } from '../src/data/brand.js';

const origin = 'http://127.0.0.1:4193';
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4193' }, stdio: 'ignore' });
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const builtHome = await readFile('dist/index.html', 'utf8');
const publicOrigin = new URL(builtHome.match(/<link rel="canonical" href="([^"]+)"/)[1]).origin;
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* Wait for server. */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  assert.equal((sitemap.match(/<loc>/g) || []).length, INDEXABLE_PATHS.length);
  assert.ok(!sitemap.includes('/settings') && !sitemap.includes('/api/'));
  assert.ok((await (await fetch(`${origin}/robots.txt`)).text()).includes(`Sitemap: ${publicOrigin}/sitemap.xml`));
  const titles = new Set();
  for (let start = 0; start < APP_PATHS.length; start += 8) {
    const results = await Promise.allSettled(APP_PATHS.slice(start, start + 8).map(async (path) => {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, `HTTP status: ${path}`);
      assert.equal(response.redirected, false, `Unexpected redirect: ${path}`);
      const html = await response.text(), seo = getPageSeo(path, publicOrigin);
      assert.ok(html.includes(`<title>${escape(seo.title)}</title>`), `Static title: ${path}`);
      assert.ok(html.includes(`<link rel="canonical" href="${escape(seo.canonical)}"`), `Canonical: ${path}`);
      assert.ok(html.includes(`content="${escape(seo.description)}"`), `Description: ${path}`);
      assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
      assert.ok(html.includes('og:image') && html.includes('twitter:card'));
      JSON.parse(html.match(/<script id="page-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.ok(html.includes('<h1') && html.includes('id="root"><div'), `Readable HTML body: ${path}`);
      if (seo.tool) assert.ok(html.includes(`How to use ${escape(seo.tool.name)}`), `Static tool content: ${path}`);
      titles.add(seo.title);
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  assert.equal(titles.size, APP_PATHS.length);
  assert.equal((await fetch(`${origin}/missing-tool-123`)).status, 404);
  assert.equal((await fetch(`${origin}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${origin}/api/not-a-function`)).status, 404);
  assert.equal((await fetch(`${origin}/api/chat`)).status, 405);
  const alias = await fetch(`${origin}/merge-pdf/index.html`, { redirect: 'manual' });
  assert.equal(alias.status, 308); assert.equal(alias.headers.get('location'), '/merge-pdf');
  const image = await fetch(`${origin}/social-card.png`);
  assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/png/);
  const png = await readFile('public/social-card.png');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  console.log(`HTTP checks passed: ${APP_PATHS.length} static pages, unique metadata, sitemap, robots, social image, API isolation and real 404s.`);

  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const noJs = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const crawler = await noJs.newPage();
  await crawler.goto(`${origin}/pdf-to-word`);
  await crawler.getByRole('heading', { name: 'PDF to Word', exact: true }).waitFor();
  await crawler.getByRole('heading', { name: 'How to use PDF to Word', exact: true }).waitFor();
  assert.ok(await crawler.getByRole('link', { name: 'PDF to JPG', exact: true }).count());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/pdf-translator`, { waitUntil: 'networkidle' });
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  assert.equal(manifestHref, `/manifest.json?v=${BRAND_ICONS.version}`);
  const manifest = await (await fetch(`${origin}${manifestHref}`)).json();
  for (const icon of manifest.icons) {
    const response = await fetch(`${origin}${icon.src}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
    assert.ok(icon.src.includes(BRAND_ICONS.version));
  }
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.equal(await page.locator('link[rel=icon]').getAttribute('href'), BRAND_ICONS.favicon32);
  assert.equal(await page.locator('link[rel=apple-touch-icon]').getAttribute('href'), BRAND_ICONS.apple180);
  const session = await page.context().newCDPSession(page);
  const appManifest = await session.send('Page.getAppManifest');
  assert.ok(appManifest.url.endsWith(manifestHref));
  assert.deepEqual(JSON.parse(appManifest.data).icons, manifest.icons);
  await session.detach();
  console.log('App icon checks passed: browser manifest, versioned PNG icons, physical sizes, favicon and Apple touch icon.');
  await page.getByRole('button', { name: 'Translate entire PDF', exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Translate entire PDF', exact: true }).waitFor();
  assert.equal(await page.title(), getPageSeo('/pdf-translator', publicOrigin).title);
  const related = await page.locator('.tool-guide-links a').first().getAttribute('href');
  await page.locator('.tool-guide-links a').first().click();
  await page.waitForURL(`${origin}${related}`);
  await page.waitForFunction((title) => document.title === title, getPageSeo(related, publicOrigin).title);
  assert.equal(await page.locator('link[rel=canonical]').count(), 1);
  assert.equal(await page.locator('script#page-structured-data').count(), 1);
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), getPageSeo(related, publicOrigin).canonical);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(`${origin}/missing-tool-123`);
  await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
  assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/);
  assert.deepEqual(errors, []);
  assert.ok((await stat('dist/pdf-to-word/index.html')).size > 1000);
  console.log('Browser checks passed: no-JavaScript tool content, mobile deep-link refresh, client-side metadata updates and no horizontal overflow.');
} finally { await browser?.close(); server.kill(); }
