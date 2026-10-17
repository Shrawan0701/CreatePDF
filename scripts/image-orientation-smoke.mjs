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
    // Screenshot-shaped fixtures have distinct corners so losing either side
    // or the top/bottom of an image is visible in the downloaded PDF.
    for (const [width, height] of [[192, 108], [108, 192], [128, 128]]) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ddd';
      context.fillRect(0, 0, width, height);
      for (const [index, color] of ['#e02020', '#20c040', '#2040e0', '#e0c020'].entries()) {
        context.fillStyle = color;
        context.fillRect(index % 2 ? width * 0.8 : 0, index >= 2 ? height * 0.8 : 0, width * 0.2, height * 0.2);
      }
      fixtures.push(new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], `corners-${width}x${height}.png`, { type: 'image/png' }));
    }

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
        return { width: canvas.width, height: canvas.height, canvas };
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
          const scale = (options.fitMode === 'fill' ? Math.max : Math.min)((viewport.width - margin * 2) / original.width, (viewport.height - margin * 2) / original.height);
          const width = original.width * scale;
          const height = original.height * scale;
          const reference = document.createElement('canvas');
          reference.width = canvas.width;
          reference.height = canvas.height;
          const referenceContext = reference.getContext('2d');
          referenceContext.fillStyle = '#fff';
          referenceContext.fillRect(0, 0, reference.width, reference.height);
          referenceContext.beginPath();
          referenceContext.rect(margin, margin, viewport.width - margin * 2, viewport.height - margin * 2);
          referenceContext.clip();
          referenceContext.drawImage(original.canvas, (viewport.width - width) / 2, (viewport.height - height) / 2, width, height);
          // Compare page edges as well as the photo: fill must cover the page,
          // while explicit margins must stay white even when cropping.
          for (const xFraction of [0.01, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 0.99]) {
            for (const yFraction of [0.01, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 0.99]) {
              const x = Math.floor(xFraction * canvas.width);
              const y = Math.floor(yFraction * canvas.height);
              // Canvas and PDF rasterizers antialias fractional rectangle
              // edges differently; compare pixels outside that one-pixel band.
              const nearVerticalEdge = [margin, viewport.width - margin, (viewport.width - width) / 2, (viewport.width + width) / 2].some(edge => Math.abs(x + 0.5 - edge) < 1);
              const nearHorizontalEdge = [margin, viewport.height - margin, (viewport.height - height) / 2, (viewport.height + height) / 2].some(edge => Math.abs(y + 0.5 - edge) < 1);
              if (nearVerticalEdge || nearHorizontalEdge) continue;
              const actual = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
              const wanted = referenceContext.getImageData(x, y, 1, 1).data;
              // Sharp fixture details can also land between device pixels.
              // Compare flat regions; corner checks below verify the edges.
              const radius = Math.max(1, Math.ceil(scale));
              const nearby = referenceContext.getImageData(Math.max(0, x - radius), Math.max(0, y - radius), radius * 2 + 1, radius * 2 + 1).data;
              if (nearby.some((value, index) => index % 4 < 3 && Math.abs(value - wanted[index % 4]) > 20)) continue;
              if ([0, 1, 2].some(channel => Math.abs(actual[channel] - wanted[channel]) > 20)) {
                throw new Error(`Image ${index + 1}: PDF orientation, fit, or margin differs from preview at ${x},${y}: ${JSON.stringify({ options, actual: Array.from(actual), wanted: Array.from(wanted) })}`);
              }
            }
          }
          if (options.fitMode !== 'fill') {
            // All four image corners must survive fitting, including wide
            // screenshots whose edges are far from the paper's corners.
            for (const xFraction of [0.05, 0.95]) {
              for (const yFraction of [0.05, 0.95]) {
                const x = Math.floor((viewport.width - width) / 2 + xFraction * width);
                const y = Math.floor((viewport.height - height) / 2 + yFraction * height);
                const actual = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
                const wanted = referenceContext.getImageData(x, y, 1, 1).data;
                if ([0, 1, 2].some(channel => Math.abs(actual[channel] - wanted[channel]) > 20)) {
                  throw new Error(`Image ${index + 1}: a corner of the full image was lost.`);
                }
              }
            }
          }
        }
      } finally { await task.destroy(); }
    };

    for (const options of [{}, { pageSize: [240, 320], margin: 20 }, { pageSize: [320, 240], margin: 15 }, { pageSize: [595.28, 841.89], fitMode: 'fill' }, { pageSize: [320, 240], fitMode: 'fill', margin: 15 }]) {
      const output = await imagesToPdf(fixtures, options);
      await validate(new Uint8Array(await output.arrayBuffer()), expected, options);
    }
    globalThis.orientationRegression = { validate, expected: [...expected.slice(0, 8), ...expected.slice(-3)] };
    return Promise.all([...fixtures.slice(0, 8), ...fixtures.slice(-3)].map(async file => ({ name: file.name, mimeType: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })));
  });

  await page.locator('input[type="file"]').setInputFiles(fixtures.map(({ name, mimeType, bytes }) => ({ name, mimeType, buffer: Buffer.from(bytes) })));
  assert.equal(await page.getByRole('combobox', { name: 'Page Size', exact: true }).inputValue(), 'A4');
  assert.equal(await page.getByRole('combobox', { name: 'Image Fit' }).inputValue(), 'fit');
  assert.equal(await page.getByRole('img', { name: 'Page 1 preview', exact: true }).evaluate(image => getComputedStyle(image).objectFit), 'contain');
  const checkDownload = async options => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Convert ${fixtures.length} Images to PDF` }).click();
    const download = await downloadPromise;
    const output = await readFile(await download.path());
    await page.evaluate(async ({ bytes, options }) => {
      const { validate, expected } = globalThis.orientationRegression;
      await validate(new Uint8Array(bytes), expected, options);
    }, { bytes: Array.from(output), options });
  };
  await checkDownload({ pageSize: [595.28, 841.89], fitMode: 'fit' });
  await page.getByRole('combobox', { name: 'Orientation' }).selectOption('landscape');
  await page.getByRole('spinbutton', { name: 'Margin (pt)' }).fill('20');
  await checkDownload({ pageSize: [841.89, 595.28], fitMode: 'fit', margin: 20 });
  await page.getByRole('combobox', { name: 'Image Fit' }).selectOption('fill');
  await checkDownload({ pageSize: [841.89, 595.28], fitMode: 'fill', margin: 20 });
  await page.getByRole('combobox', { name: 'Page Size', exact: true }).selectOption('image');
  await checkDownload({});
  assert.deepEqual(errors, []);
  console.log('Image PDF checks passed: full image corners, wide/tall/square screenshots, all 8 EXIF orientations, uniform pages, fill/fit/margins, and 4 UI download layouts.');
} finally {
  await browser?.close();
  server.kill();
}
