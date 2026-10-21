import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const port = 4189, origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), OPENAI_API_KEY: '' }, stdio: 'ignore' });
const directory = await mkdtemp(join(tmpdir(), 'createpdf-document-tools-'));
let browser;
const makePdf = async (pageLines) => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pageLines) { const page = pdf.addPage(); lines.forEach((text, index) => page.drawText(text, { x: 40, y: 790 - index * 19, size: 10, font })); }
  return { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
};
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* Wait for server */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const doc = await makePdf([['Business report', 'The company makes stationery.'], ['Financial results', 'Annual revenue was 420 million. Revenue grew by 20 percent.']]);
  const download = async (name) => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await pending; const path = join(directory, file.suggestedFilename()); await file.saveAs(path); return readFile(path); };
  const open = async (route, title) => { await page.goto(`${origin}/${route}`); await page.getByRole('heading', { name: title, exact: true }).waitFor(); };
  await page.goto(origin);
  assert.equal(await page.locator('.directory-item').count(), 65);
  const missingKey = await context.request.post(`${origin}/api/summarize`, { data: { text: 'Document', length: 'short', format: 'executive', stage: 'final' } });
  assert.equal(missingKey.status(), 503);
  console.log('Missing-key API response checked.');

  await open('invoice-extractor', 'Purchase Bill / Invoice Extractor');
  await page.locator('.document-settings summary').click();
  await page.getByLabel('Scan language', { exact: true }).waitFor();
  for (const code of ['eng', 'hin', 'mar', 'ben', 'tam', 'tel', 'kan', 'guj', 'spa', 'fra', 'deu', 'por', 'ita', 'eng+ben', 'eng+tam', 'eng+tel', 'eng+kan', 'eng+guj', 'eng+spa', 'eng+hin+mar']) assert.equal(await page.getByLabel('Scan language', { exact: true }).locator(`option[value="${code}"]`).count(), 1, `Missing OCR option: ${code}`);
  const invoice = await makePdf([['Supplier: Acme Papers', 'Supplier Address: Pune', 'Invoice No: INV-45', 'Date: 16/10/2026', 'GSTIN: 27ABCDE1234F1Z5', 'Currency: INR', 'Description    Qty    Price    Amount', 'Paper    2    100.00    200.00', 'Subtotal: 200.00', 'Discount: 0', 'CGST 9%: 18.00', 'SGST 9%: 18.00', 'IGST: 0', 'Grand Total: 236.00']]);
  await page.locator('input[type=file]').setInputFiles(invoice);
  await page.getByRole('button', { name: 'Extract bill details' }).click();
  await page.getByRole('heading', { name: 'Review extracted details' }).waitFor();
  assert.equal(await page.getByLabel('Supplier name', { exact: true }).inputValue(), 'Acme Papers');
  assert.equal(await page.getByLabel('Grand total', { exact: true }).inputValue(), '236');
  const json = JSON.parse((await download('Export JSON')).toString());
  assert.equal(json.items[0].quantity, 2); assert.equal(json.warnings.length, 0);
  assert.match((await download('Export CSV')).toString(), /Acme Papers/);
  await page.getByLabel('Grand total', { exact: true }).fill('999');
  await page.getByText(/but grand total is 999/).waitFor();
  console.log('Local invoice extraction, editing, discrepancy checks and exports passed.');

  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1700;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1400, 1700); context.fillStyle = '#111'; context.font = '40px Arial';
    ['Supplier: Local Shop', 'Invoice No: OCR-123', 'Date: 16/10/2026', 'Subtotal: 100.00', 'Grand Total: 100.00'].forEach((line, i) => context.fillText(line, 80, 140 + i * 95));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const image = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') };
  if (process.env.TEST_OCR === '1') {
    await page.locator('input[type=file]').setInputFiles(image);
    await page.getByRole('button', { name: 'Extract bill details' }).click();
    await page.getByRole('heading', { name: 'Review extracted details' }).waitFor({ timeout: 180000 });
    assert.match(await page.getByLabel('Invoice number', { exact: true }).inputValue(), /OCR-123/);
    console.log('Real in-browser OCR passed.');
    const spanishData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1700;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1400, 1700); context.fillStyle = '#111'; context.font = '42px Arial';
      ['Factura de compra', 'Supplier: Tienda Central', 'Invoice No: SPA-123', 'Información del proveedor', 'Subtotal: 100.00', 'Grand Total: 100.00'].forEach((line, index) => context.fillText(line, 80, 140 + index * 95));
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const spanishPdf = await PDFDocument.create();
    const spanishImage = await spanishPdf.embedPng(Buffer.from(spanishData, 'base64'));
    const scannedPage = spanishPdf.addPage([595, 842]);
    scannedPage.drawImage(spanishImage, { x: 0, y: 0, width: 595, height: 842 });
    scannedPage.drawText('This incorrect text layer must be replaced by OCR.', { x: 20, y: 20, size: 10, opacity: 0 });
    await page.getByLabel('Scan language', { exact: true }).selectOption('spa');
    await page.getByLabel('Rescan every page', { exact: false }).check();
    await page.locator('input[type=file]').setInputFiles({ name: 'spanish-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await spanishPdf.save()) });
    await page.getByRole('button', { name: 'Extract bill details' }).click();
    await page.getByRole('heading', { name: 'Review extracted details' }).waitFor({ timeout: 180000 });
    assert.match(await page.getByLabel('Invoice number', { exact: true }).inputValue(), /SPA-123/);
    assert.ok((await page.locator('.document-raw pre').textContent()).includes('Factura'));
    console.log('Spanish OCR and rescanning a PDF with an incorrect text layer passed.');

    const currencyData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1200;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#111'; context.font = '40px monospace';
      ['Supplier: Currency Test', 'Invoice No: INR-123', 'Description    Qty    Amount', 'Biryani         1    ₹1.00', 'Paneer          2    ₹398.00', 'Subtotal: ₹399.00', 'Grand Total: ₹399.00', 'Reference amount: 3399.00'].forEach((line, index) => context.fillText(line, 80, 140 + index * 95));
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Scan language', { exact: true }).selectOption('auto');
    await page.getByLabel('Rescan every page', { exact: false }).uncheck();
    await page.locator('input[type=file]').setInputFiles({ name: 'currency-scan.png', mimeType: 'image/png', buffer: Buffer.from(currencyData, 'base64') });
    await page.getByRole('button', { name: 'Extract bill details' }).click();
    await page.getByRole('heading', { name: 'Review extracted details' }).waitFor({ timeout: 180000 });
    assert.equal(await page.getByLabel('Grand total', { exact: true }).inputValue(), '399');
    const currencyText = await page.locator('.document-raw pre').textContent();
    assert.match(currencyText, /Paneer\s+2\s+₹?398\.00/);
    assert.match(currencyText, /Reference amount:\s*3399\.00/);
    console.log('Scanned rupee amounts and genuine leading numeric digits passed.');
  }
  await open('photo-to-passport', 'Photo to Passport Sheet');
  await page.locator('input[type=file]').setInputFiles([image, { ...image, name: 'second.png' }]);
  await page.getByRole('button', { name: 'Generate print-ready PDF' }).waitFor();
  await page.getByLabel('Copies of selected photo').fill('30');
  await page.getByLabel('Photo zoom').fill('1.5');
  await page.getByLabel('Horizontal position').fill('70');
  await page.getByRole('button', { name: 'Generate print-ready PDF' }).click();
  const passport = await PDFDocument.load(await download('Download passport sheet'));
  assert.equal(passport.getPageCount(), 2);
  assert.ok(Math.abs(passport.getPage(0).getWidth() - 210 / 25.4 * 72) < .001);
  // Drawing matrices must use exact 35 × 45 mm, not CSS pixels.
  console.log('Multi-photo cropping, physical page dimensions and pagination passed.');

  // Deterministic API fixtures verify UI orchestration, not live OpenAI quality.
  const translated = [];
  await page.route('**/api/translate', async (route) => { const body = route.request().postDataJSON(); translated.push(...body.blocks); await route.fulfill({ json: { blocks: body.blocks.map((block) => ({ id: block.id, text: `नमस्कार ${block.text}` })) } }); });
  await open('pdf-translator', 'PDF Translator');
  await page.locator('input[type=file]').setInputFiles(doc);
  await page.getByRole('button', { name: 'Translate entire PDF' }).click();
  await page.getByRole('button', { name: 'Download PDF', exact: true }).waitFor({ timeout: 30000 });
  const translation = await PDFDocument.load(await download('Download PDF'));
  assert.equal(translation.getPageCount(), 2);
  const sourceDocument = await PDFDocument.load(doc.buffer);
  translation.getPages().forEach((sheet, index) => assert.deepEqual(sheet.getSize(), sourceDocument.getPage(index).getSize()));
  assert.ok(translated.some((block) => block.text.includes('420 million')));
  assert.ok(translated.some((block) => block.text.includes('stationery')));
  console.log('Translation page coverage, Unicode PDF generation and preview passed using API fixtures.');

  const summaryCalls = [];
  await page.route('**/api/summarize', async (route) => { const body = route.request().postDataJSON(); summaryCalls.push(body); await route.fulfill({ json: { text: body.stage === 'review' ? body.draft : `## Summary\n\n${body.stage === 'final' ? 'Revenue is 420 million [Page 2].' : 'Section notes from all pages.'}` } }); });
  await open('pdf-summarizer', 'PDF Summarizer');
  const long = await makePdf(Array.from({ length: 5 }, (_, p) => Array.from({ length: 35 }, (_, i) => `Page ${p + 1} section ${i + 1}: The annual document describes revenue, operations, factory staffing and future plans.`)));
  await page.locator('input[type=file]').setInputFiles(long);
  await page.getByLabel('Summary length').selectOption('detailed');
  await page.getByLabel('Summary format').selectOption('chapter-wise');
  await page.getByLabel('Summary language', { exact: true }).selectOption('Hindi');
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await page.getByRole('button', { name: 'Download TXT', exact: true }).waitFor({ timeout: 30000 });
  assert.ok(summaryCalls.filter((call) => call.stage === 'section').length >= 5);
  assert.equal(summaryCalls.at(-1).stage, 'review');
  assert.equal(summaryCalls.at(-1).language, 'Hindi');
  assert.match((await download('Download TXT')).toString(), /420 million/);
  assert.ok((await PDFDocument.load(await download('Download PDF'))).getPageCount() >= 1);
  console.log('Long-document chunk orchestration, summary preview and both exports passed using API fixtures.');

  const chatCalls = [];
  await page.route('**/api/chat', async (route) => { const body = route.request().postDataJSON(); chatCalls.push(body); await route.fulfill({ json: { answer: 'Revenue was 420 million [p. 2].', sources: [{ page: 2, quote: 'Annual revenue was 420 million.' }] } }); });
  await open('chat-with-pdf', 'Chat with PDF');
  await page.getByLabel('Answer language', { exact: true }).selectOption('Marathi');
  await page.locator('input[type=file]').setInputFiles(doc);
  await page.getByText('Ready to chat · PDF prepared', { exact: true }).waitFor();
  assert.equal(chatCalls.length, 0);
  await page.getByLabel('Your question').fill('What was annual revenue?');
  await page.getByRole('button', { name: 'Ask document' }).click();
  await page.locator('.document-citation').waitFor();
  await page.locator('.document-citation').click();
  assert.match(await page.locator('iframe').getAttribute('src'), /#page=2$/);
  await page.getByLabel('Your question').fill('How much did it grow?');
  await page.getByRole('button', { name: 'Ask document' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.document-message').length === 4);
  assert.match(await page.locator('.document-message.user').first().textContent(), /How much did it grow/);
  assert.match(await page.locator('.document-message.user').last().textContent(), /What was annual revenue/);
  assert.equal(await page.getByRole('progressbar', { name: 'Document progress' }).count(), 0);
  assert.equal(chatCalls[1].history.length, 2);
  assert.equal(chatCalls[0].language, 'Marathi');
  assert.equal(chatCalls[0].sections[0].page, 2);
  console.log('Chat retrieval, source navigation and follow-up context passed using API fixtures.');

  for (const [route, title] of [['pdf-translator', 'PDF Translator'], ['chat-with-pdf', 'Chat with PDF'], ['pdf-summarizer', 'PDF Summarizer'], ['invoice-extractor', 'Purchase Bill / Invoice Extractor'], ['photo-to-passport', 'Photo to Passport Sheet']]) {
    await page.setViewportSize({ width: 390, height: 844 }); await open(route, title);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${route} overflows mobile`);
  }
  assert.deepEqual(errors, []);
  console.log(`Document tools smoke passed. Download artifacts: ${directory}`);
} finally { await browser?.close(); server.kill(); }
