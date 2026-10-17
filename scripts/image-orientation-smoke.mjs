import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = 'http://127.0.0.1:4186';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'], { stdio: 'ignore' });
let browser;

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* Starting Vite. */ }
    if (attempt >= 120) throw new Error('Vite did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/images-to-pdf`, { waitUntil: 'networkidle' });

  const fixtures = await page.evaluate(async () => {
    const { imagesToPdf, getPdfjsLib } = await import('/src/services/pdfEngine.js');
    const pdfjs = await getPdfjsLib();
    const source = document.createElement('canvas');
    source.width = 96;
    source.height = 64;
    const context = source.getContext('2d');
    for (const [index, color] of ['#e02020', '#20c040', '#2040e0', '#e0c020'].entries()) {
      context.fillStyle = color;
      context.fillRect((index % 2) * 48, Math.floor(index / 2) * 32, 48, 32);
    }
    const jpeg = new Uint8Array(await (await new Promise(resolve => source.toBlob(resolve, 'image/jpeg', 1))).arrayBuffer());
    const fixtures = [];
    for (const littleEndian of [true, false]) {
      for (let orientation = 1; orientation <= 8; orientation++) {
        const segment = new Uint8Array(36);
        segment.set([0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0]);
        const tiff = new DataView(segment.buffer, 10);
        tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
        tiff.setUint16(2, 42, littleEndian);
        tiff.setUint32(4, 8, littleEndian);
        tiff.setUint16(8, 1, littleEndian);
        tiff.setUint16(10, 0x0112, littleEndian);
        tiff.setUint16(12, 3, littleEndian);
        tiff.setUint32(14, 1, littleEndian);
        tiff.setUint16(18, orientation, littleEndian);
        const bytes = new Uint8Array(jpeg.length + segment.length);
        bytes.set(jpeg.subarray(0, 2));
        bytes.set(segment, 2);
        bytes.set(jpeg.subarray(2), 38);
        fixtures.push(new File([bytes], `orientation-${orientation}-${littleEndian}.jpg`, { type: 'image/jpeg' }));
      }
    }
    fixtures.push(new File([jpeg], 'no-exif.jpg', { type: 'image/jpeg' }));
    for (const type of ['image/png', 'image/webp']) {
      fixtures.push(new File([await new Promise(resolve => source.toBlob(resolve, type))], `plain.${type.split('/')[1]}`, { type }));
    }

    const corners = canvas => {
      const context = canvas.getContext('2d');
      return [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) =>
        Array.from(context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data).slice(0, 3));
    };
    const expected = await Promise.all(fixtures.map(async file => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      try {
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return { width: canvas.width, height: canvas.height, colors: corners(canvas) };
      } finally { URL.revokeObjectURL(url); }
    }));

    const validate = async (bytes, expected, options = {}) => {
      const task = pdfjs.getDocument({ data: bytes });
      try {
        const pdf = await task.promise;
        if (pdf.numPages !== expected.length) throw new Error('Image order/page count changed.');
        for (let index = 0; index < expected.length; index++) {
          const original = expected[index];
          const pdfPage = await pdf.getPage(index + 1);
          const viewport = pdfPage.getViewport({ scale: 1 });
          const size = options.pageSize || [original.width, original.height];
          if (Math.abs(viewport.width - size[0]) > 0.01 || Math.abs(viewport.height - size[1]) > 0.01) {
            throw new Error(`Image ${index + 1}: incorrect oriented page size.`);
          }
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const margin = options.margin || 0;
          const scale = Math.min((canvas.width - margin * 2) / original.width, (canvas.height - margin * 2) / original.height);
          const width = original.width * scale;
          const height = original.height * scale;
          const crop = document.createElement('canvas');
          crop.width = original.width;
          crop.height = original.height;
          crop.getContext('2d').drawImage(canvas, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height, 0, 0, crop.width, crop.height);
          const actual = corners(crop);
          if (actual.some((color, corner) => color.some((value, channel) => Math.abs(value - original.colors[corner][channel]) > 15))) {
            throw new Error(`Image ${index + 1}: PDF rotation/mirroring differs from the uploaded preview: ${JSON.stringify({ actual, expected: original.colors })}`);
          }
        }
      } finally { await task.destroy(); }
    };

    for (const options of [{}, { pageSize: [240, 320], margin: 20 }, { pageSize: [320, 240], margin: 15 }]) {
      const output = await imagesToPdf(fixtures, options);
      await validate(new Uint8Array(await output.arrayBuffer()), expected, options);
    }
    globalThis.orientationRegression = { validate, expected: expected.slice(0, 8) };
    return Promise.all(fixtures.slice(0, 8).map(async file => ({ name: file.name, mimeType: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })));
  });

  await page.locator('input[type="file"]').setInputFiles(fixtures.map(({ name, mimeType, bytes }) => ({ name, mimeType, buffer: Buffer.from(bytes) })));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Convert 8 Images to PDF' }).click();
  const download = await downloadPromise;
  const output = await readFile(await download.path());
  await page.evaluate(async bytes => {
    const { validate, expected } = globalThis.orientationRegression;
    await validate(new Uint8Array(bytes), expected);
  }, Array.from(output));
  assert.deepEqual(errors, []);
  console.log('Image orientation passed: all 8 EXIF orientations, both byte orders, 3 page layouts, PNG/WebP/plain JPEG, and UI download.');
} finally {
  await browser?.close();
  server.kill();
}
