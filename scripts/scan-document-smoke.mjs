import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { PDFDocument } from 'pdf-lib'

const origin = 'http://127.0.0.1:4214'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4214', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt > 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/scan-document`, { waitUntil: 'networkidle' })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/scan-document-empty.png', fullPage: true, animations: 'disabled' })
  assert.equal(await page.getByRole('button', { name: 'Create scanned PDF', exact: true }).isDisabled(), true)
  const fixtures = await page.evaluate(async () => {
    const results = []
    for (const [width, height] of [[800, 1200], [1200, 800], [900, 900]]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e3e7eb'; ctx.fillRect(0, 0, width, height)
      for (const [index, color] of ['#e02020', '#20c040', '#2040e0', '#e0c020'].entries()) {
        ctx.fillStyle = color; ctx.fillRect(index % 2 ? width * .8 : 0, index >= 2 ? height * .8 : 0, width * .2, height * .2)
      }
      ctx.fillStyle = '#182b24'; ctx.font = 'bold 40px Arial'; ctx.fillText('DOCUMENT PAGE', width * .2, height * .45)
      results.push({ name: `${width}x${height}.png`, mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] })
    }
    return results
  })
  const upload = files => page.locator('.scan-drop input[type=file]').setInputFiles(files)
  await upload(fixtures.map(({ data, ...file }) => ({ ...file, buffer: Buffer.from(data, 'base64') })))
  const ready = () => page.waitForFunction(() => document.querySelectorAll('.scan-thumb').length > 0 && !document.querySelector('.scan-rendering'))
  await ready()
  assert.equal(await page.locator('.scan-thumb').count(), 3)
  const exportPdf = async expectedSizes => {
    await ready()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Create scanned PDF', exact: true }).click()
    const download = await pending
    await download.saveAs('artifacts/scan-document-example.pdf')
    const bytes = await readFile(await download.path())
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), expectedSizes.length)
    pdf.getPages().forEach((pdfPage, index) => {
      assert.ok(Math.abs(pdfPage.getWidth() - expectedSizes[index][0]) < .02)
      assert.ok(Math.abs(pdfPage.getHeight() - expectedSizes[index][1]) < .02)
    })
    await page.getByRole('button', { name: 'Create scanned PDF', exact: true }).waitFor()
    // Compare the real downloaded page to the visible preview. This catches
    // mismatched cropping, rotation, image positioning, and color adjustments.
    const index = await page.locator('.scan-page-select').evaluateAll(buttons => buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true'))
    const difference = await page.evaluate(async ({ data, index }) => {
      const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
      const pdfjs = await getPdfjsLib()
      const task = pdfjs.getDocument({ data: new Uint8Array(data) })
      try {
        const pdf = await task.promise
        const pdfPage = await pdf.getPage(index + 1)
        const preview = document.querySelector('.scan-preview canvas')
        const viewport = pdfPage.getViewport({ scale: preview.width / pdfPage.getViewport({ scale: 1 }).width })
        const actual = document.createElement('canvas'); actual.width = preview.width; actual.height = preview.height
        await pdfPage.render({ canvasContext: actual.getContext('2d'), viewport }).promise
        const expected = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data
        const pixels = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
        let error = 0, count = 0
        for (let offset = 0; offset < pixels.length; offset += 16) {
          for (let channel = 0; channel < 3; channel++) { error += Math.abs(pixels[offset + channel] - expected[offset + channel]); count++ }
        }
        return error / count
      } finally { await task.destroy() }
    }, { data: [...bytes], index })
    assert.ok(difference < 5, `PDF and preview differ by ${difference} intensity levels`)
    return pdf
  }
  await exportPdf([[595.28, 841.89], [841.89, 595.28], [595.28, 841.89]])
  await page.getByRole('button', { name: 'Edit page 2', exact: true }).click()
  await exportPdf([[595.28, 841.89], [841.89, 595.28], [595.28, 841.89]])
  await page.getByRole('button', { name: 'Rotate 90°' }).click()
  await page.getByRole('slider', { name: 'Crop edges', exact: true }).fill('10')
  await page.getByRole('slider', { name: 'Brightness', exact: true }).fill('120')
  await page.getByRole('slider', { name: 'Contrast', exact: true }).fill('130')
  await exportPdf([[595.28, 841.89], [595.28, 841.89], [595.28, 841.89]])
  await page.getByLabel('Orientation', { exact: true }).selectOption('landscape')
  await page.getByLabel('Image fit', { exact: true }).selectOption('fill')
  await page.getByLabel('Margins', { exact: true }).selectOption('36')
  await exportPdf([[841.89, 595.28], [841.89, 595.28], [841.89, 595.28]])
  await page.getByLabel('Page size', { exact: true }).selectOption('letter')
  await exportPdf([[792, 612], [792, 612], [792, 612]])
  await page.getByLabel('Page size', { exact: true }).selectOption('image')
  assert.equal(await page.getByLabel('Margins', { exact: true }).isDisabled(), true)
  await exportPdf([[600, 900], [480, 720], [675, 675]])
  await page.getByRole('button', { name: 'Move page 2 up', exact: true }).click()
  await exportPdf([[480, 720], [600, 900], [675, 675]])
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click()
  await exportPdf([[900, 600], [600, 900], [675, 675]])
  await page.getByLabel('Page size', { exact: true }).selectOption('a4')
  await page.getByLabel('Orientation', { exact: true }).selectOption('auto')
  await page.getByLabel('Image fit', { exact: true }).selectOption('fit')
  await page.getByLabel('Margins', { exact: true }).selectOption('18')
  await ready()
  await exportPdf([[841.89, 595.28], [595.28, 841.89], [595.28, 841.89]])
  await page.evaluate(() => scrollTo(0, 0))
  await page.locator('.toast-close').evaluateAll(buttons => buttons.forEach(button => button.click()))
  await page.screenshot({ path: 'artifacts/scan-document-preview.png', fullPage: true, animations: 'disabled' })
  await upload([{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }])
  await page.getByText(/Could not read 1 file/).waitFor()
  assert.equal(await page.locator('.scan-thumb').count(), 3)
  await page.setViewportSize({ width: 390, height: 844 })
  await ready()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile layout overflows horizontally')
  const fits = await page.locator('.scan-preview canvas').evaluate(canvas => {
    const bounds = canvas.getBoundingClientRect(), parent = canvas.closest('.scan-preview').getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0 && bounds.left >= parent.left && bounds.right <= parent.right + 1 && bounds.top >= parent.top && bounds.bottom <= parent.bottom + 1
  })
  assert.ok(fits, 'Preview exceeds its mobile container')
  await page.locator('.toast-close').evaluateAll(buttons => buttons.forEach(button => button.click()))
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: 'artifacts/scan-document-mobile.png', fullPage: true, animations: 'disabled' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: 'artifacts/scan-document-dark-mobile.png', fullPage: true, animations: 'disabled' })
  for (let count = 3; count > 0; count--) await page.getByRole('button', { name: 'Remove page 1', exact: true }).click()
  assert.equal(await page.locator('.scan-thumb').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Create scanned PDF', exact: true }).isDisabled(), true)
  // Transparent paper must stay white when encoded as JPEG. Verify EXIF is
  // applied once using the browser's decoded reference, including mirroring.
  await page.evaluate(async () => {
    const { renderScanImage, SCAN_DEFAULTS } = await import('/src/services/scanDocument.js')
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64
    let file = new File([await new Promise(resolve => canvas.toBlob(resolve))], 'transparent.png', { type: 'image/png' })
    let rendered = await renderScanImage({ file, ...SCAN_DEFAULTS })
    if ([...rendered.getContext('2d').getImageData(5, 5, 1, 1).data].some(value => value !== 255)) throw new Error('Transparent scan is not white')
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e02020'; ctx.fillRect(0, 0, 48, 64); ctx.fillStyle = '#2040e0'; ctx.fillRect(48, 0, 48, 64)
    const jpeg = new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1))).arrayBuffer())
    for (let orientation = 1; orientation <= 8; orientation++) {
      const segment = new Uint8Array(36); segment.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0])
      const tiff = new DataView(segment.buffer, 10)
      tiff.setUint16(0, 0x4949); tiff.setUint16(2, 42, true); tiff.setUint32(4, 8, true); tiff.setUint16(8, 1, true)
      tiff.setUint16(10, 0x0112, true); tiff.setUint16(12, 3, true); tiff.setUint32(14, 1, true); tiff.setUint16(18, orientation, true)
      file = new File([jpeg.subarray(0, 2), segment, jpeg.subarray(2)], 'phone.jpg', { type: 'image/jpeg' })
      const url = URL.createObjectURL(file), reference = new Image(); reference.src = url
      try {
        await reference.decode()
        rendered = await renderScanImage({ file, ...SCAN_DEFAULTS })
        if (rendered.width !== reference.naturalWidth || rendered.height !== reference.naturalHeight) throw new Error(`EXIF ${orientation} dimensions incorrect`)
        const expected = document.createElement('canvas'); expected.width = rendered.width; expected.height = rendered.height; expected.getContext('2d').drawImage(reference, 0, 0)
        const actualPixel = rendered.getContext('2d').getImageData(8, 8, 1, 1).data, expectedPixel = expected.getContext('2d').getImageData(8, 8, 1, 1).data
        if (actualPixel.some((value, index) => Math.abs(value - expectedPixel[index]) > 3)) throw new Error(`EXIF ${orientation} pixels incorrect`)
      } finally { URL.revokeObjectURL(url) }
    }
  })
  assert.deepEqual(errors, [])
  console.log('Scan document verified: actual downloaded PDFs match previews; portrait/landscape/square images; A4/Letter/image sizing; fit/fill/margins; crop/rotation/adjustments/reset; ordering/removal; corrupt files; transparency; all eight EXIF orientations; mobile fitting; dark-mode screenshots.')
} finally { await browser?.close(); server.kill() }
