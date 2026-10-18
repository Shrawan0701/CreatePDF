import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, rgb } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4201'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4201', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite starting. */ }
    if (attempt >= 120) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/extract-images`, { waitUntil: 'networkidle' })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/extract-images-empty.png', fullPage: true })
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0d7865'; ctx.fillRect(0, 0, 60, 80)
    ctx.fillStyle = 'rgba(240, 80, 40, 0.5)'; ctx.fillRect(60, 0, 60, 40)
    return { png: canvas.toDataURL('image/png').split(',')[1], jpg: canvas.toDataURL('image/jpeg', .92).split(',')[1] }
  })
  const pdf = await PDFDocument.create()
  const png = await pdf.embedPng(Buffer.from(raster.png, 'base64'))
  const jpg = await pdf.embedJpg(Uint8Array.from(Buffer.from(raster.jpg, 'base64')))
  const first = pdf.addPage([600, 800])
  first.drawImage(png, { x: 30, y: 650, width: 120, height: 80 })
  first.drawImage(jpg, { x: 200, y: 650, width: 120, height: 80 })
  // A 9px-wide 1-bit image has seven padding bits on each row.
  const mono = pdf.context.register(pdf.context.flateStream(new Uint8Array([0b10101010, 0b10000000, 0b01010101, 0]), {
    Type: PDFName.of('XObject'), Subtype: PDFName.of('Image'), Width: 9, Height: 2,
    BitsPerComponent: 1, ColorSpace: PDFName.of('DeviceGray'),
  }))
  const monoName = first.node.newXObject('Mono', mono)
  const mask = pdf.context.register(pdf.context.flateStream(new Uint8Array([0b01010101, 0b10101010]), {
    Type: PDFName.of('XObject'), Subtype: PDFName.of('Image'), Width: 8, Height: 2,
    BitsPerComponent: 1, ImageMask: true,
  }))
  const maskName = first.node.newXObject('Mask', mask)
  first.node.addContentStream(pdf.context.register(pdf.context.flateStream(Buffer.from(`q 90 0 0 20 30 580 cm ${monoName} Do Q\nq 0.2 0.4 0.8 rg 80 0 0 20 200 580 cm ${maskName} Do Q`))))
  const second = pdf.addPage([600, 800])
  second.drawImage(png, { x: 30, y: 650, width: 120, height: 80 })
  const third = pdf.addPage([600, 800])
  // Repeated image operators and a globally cached resource shared with earlier pages.
  for (let i = 0; i < 12; i++) third.drawImage(png, { x: (i % 4) * 130, y: 700 - Math.floor(i / 4) * 100, width: 120, height: 80 })
  const fourth = pdf.addPage([600, 800])
  const inline = []
  for (let i = 0; i < 12; i++) {
    inline.push(Buffer.from(`q 20 0 0 20 ${(i % 6) * 30} ${700 - Math.floor(i / 6) * 30} cm\nBI /W 2 /H 2 /CS /RGB /BPC 8 ID `))
    inline.push(Buffer.from(Array.from({ length: 4 }, () => [20 + i * 15, 70, 130]).flat()))
    inline.push(Buffer.from(' EI\nQ\n'))
  }
  fourth.node.addContentStream(pdf.context.register(pdf.context.flateStream(Buffer.concat(inline))))
  const blank = pdf.addPage([600, 800]); blank.drawRectangle({ x: 30, y: 50, width: 90, height: 20, color: rgb(.1, .3, .2) })
  const source = { name: 'image-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  await writeFile('artifacts/extract-images-fixture.pdf', source.buffer)
  const upload = async (file = source) => page.locator('input[type=file]').setInputFiles(file)
  const run = async () => {
    await page.getByRole('button', { name: /^(Extract images|Extract again)$/ }).click()
    await page.waitForFunction(() => !document.querySelector('.extract-library[aria-busy="true"]'))
  }
  const download = async locator => {
    const pending = page.waitForEvent('download')
    await locator.click()
    const output = await pending
    return { name: output.suggestedFilename(), bytes: await readFile(await output.path()) }
  }
  const zipButton = () => page.getByRole('button', { name: 'Download images ZIP', exact: true })
  await upload(); await run()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(await page.locator('.extract-warning').count(), 0)
  assert.equal(await page.locator('.extract-image-card').count(), 16, 'Missing extracted images or duplicate suppression failed')
  await page.screenshot({ path: 'artifacts/extract-images-results.png', fullPage: true })
  await page.getByRole('checkbox', { name: 'Hide duplicates' }).uncheck()
  assert.equal(await page.locator('.extract-image-card').count(), 18)
  await page.getByRole('checkbox', { name: 'Hide duplicates' }).check()
  const archive = await download(zipButton())
  assert.equal(archive.name, 'image-fixture-images.zip')
  const entries = Object.values((await JSZip.loadAsync(archive.bytes)).files).filter(entry => !entry.dir)
  assert.equal(entries.length, 16)
  const pixelCheck = async (entry, coordinates = [[0, 0]]) => page.evaluate(async ({ base64, coordinates }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
    return { width: bitmap.width, height: bitmap.height, pixels: coordinates.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]) }
  }, { base64: await entry.async('base64'), coordinates })
  const pngPixels = await pixelCheck(entries.find(entry => entry.name === 'page-1-image-1.png'), [[0, 0], [90, 20], [90, 60]])
  assert.equal(pngPixels.width, 120); assert.equal(pngPixels.height, 80)
  assert.deepEqual(pngPixels.pixels[0], [13, 120, 101, 255])
  assert.equal(pngPixels.pixels[1][3], 128, 'Soft-mask transparency lost')
  assert.equal(pngPixels.pixels[2][3], 0)
  const monoPixels = await pixelCheck(entries.find(entry => entry.name === 'page-1-image-3.png'), [[0, 0], [1, 0], [0, 1], [8, 0]])
  assert.deepEqual(monoPixels, { width: 9, height: 2, pixels: [[255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]] })
  const maskPixels = await pixelCheck(entries.find(entry => entry.name === 'page-1-image-4.png'), [[0, 0], [1, 0]])
  assert.deepEqual(maskPixels.pixels, [[51, 102, 204, 255], [0, 0, 0, 0]], 'Stencil mask color or transparency changed')
  for (let i = 0; i < 12; i++) {
    const result = await pixelCheck(entries.find(entry => entry.name === `page-4-image-${i + 1}.png`))
    assert.deepEqual(result, { width: 2, height: 2, pixels: [[20 + i * 15, 70, 130, 255]] }, 'Grouped inline image was not cropped correctly')
  }
  await page.getByRole('button', { name: 'Preview page-1-image-1.png', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('ArrowRight')
  assert.ok((await page.locator('#extract-preview-title').textContent()).includes('image-2'))
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByRole('checkbox', { name: 'Select all' }).uncheck()
  assert.ok(await zipButton().isDisabled())
  await page.getByRole('checkbox', { name: 'Select page-1-image-1.png', exact: true }).check()
  const singleArchive = await download(zipButton())
  assert.equal(Object.keys((await JSZip.loadAsync(singleArchive.bytes)).files).length, 1)
  await page.getByLabel('Image format', { exact: true }).selectOption('jpg')
  const jpeg = await download(page.getByRole('button', { name: 'Download page-1-image-1.png', exact: true }))
  assert.equal(jpeg.name, 'page-1-image-1.jpg')
  assert.equal(jpeg.bytes[0], 255); assert.equal(jpeg.bytes[1], 216)
  const jpgPixels = await pixelCheck({ async: async () => jpeg.bytes.toString('base64') }, [[90, 60]])
  assert.ok(jpgPixels.pixels[0].every(channel => channel >= 250), 'JPG transparent areas were not flattened to white')
  await page.getByLabel('Source page', { exact: true }).selectOption('2')
  assert.equal(await page.locator('.extract-image-card').count(), 1)
  assert.ok(await page.getByRole('button', { name: 'Preview page-2-image-1.png', exact: true }).isVisible())
  await page.getByLabel('Minimum dimensions', { exact: true }).selectOption('300')
  await page.getByText('No images match these filters.').waitFor()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'artifacts/extract-images-mobile.png', fullPage: true })
  await page.getByLabel('Pages to extract', { exact: true }).fill('2')
  assert.equal(await page.locator('.extract-image-card').count(), 0, 'Changing page settings retained stale results')
  await run()
  assert.equal(await page.locator('.extract-image-card').count(), 1)
  await page.getByLabel('Pages to extract', { exact: true }).fill('5')
  await run(); await page.getByRole('heading', { name: 'No embedded images found' }).waitFor()
  await page.getByLabel('Pages to extract', { exact: true }).fill('99')
  await run(); await page.getByRole('alert').filter({ hasText: 'Choose pages between 1 and 5.' }).waitFor()
  await upload({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await run(); await page.getByRole('alert').filter({ hasText: 'Could not read this PDF' }).waitFor()
  await upload({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(raster.png, 'base64') })
  await page.getByRole('alert').filter({ hasText: 'Choose a PDF file' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Extract images', exact: true }).isDisabled())
  const protectedPdf = { ...source, name: 'protected.pdf', buffer: Buffer.from(await encryptPDF(Uint8Array.from(source.buffer), 'sample-pass')) }
  await upload(protectedPdf); await run()
  await page.getByRole('alert').filter({ hasText: 'This PDF needs a password.' }).waitFor()
  await page.getByText('Password-protected PDF?', { exact: true }).click()
  await page.getByLabel('PDF opening password', { exact: true }).fill('wrong-password')
  await run(); await page.getByRole('alert').filter({ hasText: 'This PDF needs a password.' }).waitFor()
  await page.getByLabel('PDF opening password', { exact: true }).fill('sample-pass')
  await run()
  assert.equal(await page.locator('.extract-image-card').count(), 16, 'Password-protected PDF extraction failed')
  assert.equal(await page.getByRole('alert').count(), 0)
  // Delayed file reads must not repopulate the gallery after cancellation/removal.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () { if (this.name === 'slow.pdf') await new Promise(resolve => setTimeout(resolve, 800)); return read.call(this) }
  })
  await upload({ ...source, name: 'slow.pdf' })
  await page.getByRole('button', { name: 'Extract images', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel extraction', exact: true }).click()
  await page.waitForTimeout(1000)
  assert.equal(await page.locator('.extract-image-card').count(), 0)
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.getByRole('button', { name: 'Extract images', exact: true }).click()
  await page.getByRole('button', { name: 'Remove slow.pdf', exact: true }).click()
  await page.waitForTimeout(1000)
  assert.ok(await page.getByRole('button', { name: 'Extract images', exact: true }).isDisabled())
  assert.equal(await page.locator('.extract-image-card').count(), 0)
  await upload(); await run()
  assert.equal(await page.locator('.extract-image-card').count(), 16, 'Recovery after cancellation failed')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: 'artifacts/extract-images-dark.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Image extraction verified: native dimensions and pixels, PNG transparency, JPG export, packed monochrome scans, colored masks, grouped inline images, repeated/global images, selection, deduplication, page/size filters, ZIP contents, keyboard preview, invalid and password-protected PDFs, cancellation, recovery, mobile, and dark mode.')
} finally {
  await browser?.close()
  server.kill()
}
