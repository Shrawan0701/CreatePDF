import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite'

const origin = 'http://127.0.0.1:4206'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4206', '--strictPort'], { stdio: 'ignore' })
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
  await page.goto(`${origin}/alternate-mix`, { waitUntil: 'networkidle' })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/alternate-mix-empty.png', fullPage: true, animations: 'disabled' })
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 60
    const context = canvas.getContext('2d'); context.fillStyle = '#0d7865'; context.fillRect(0, 0, 120, 60)
    context.fillStyle = 'white'; context.font = '17px Arial'; context.fillText('Original image', 4, 35)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const fixture = async (letter, count, name) => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.HelveticaBold)
    const image = await document.embedPng(Buffer.from(png, 'base64'))
    for (let index = 0; index < count; index++) {
      const size = letter === 'A' ? index === 1 ? [842, 595] : index === 2 ? [300, 400] : [595, 842] : [612, 792]
      const source = document.addPage(size)
      source.drawText(`${letter}${index + 1}`, { x: 40, y: size[1] - 90, font, size: 36 })
      source.drawText('Original selectable content', { x: 40, y: size[1] - 125, font, size: 12 })
      source.drawRectangle({ x: 40, y: size[1] - 145, width: 200, height: 3, color: rgb(.1, .5, .4) })
      source.drawImage(image, { x: 40, y: 40, width: 120, height: 60 })
    }
    if (letter === 'A') {
      const link = value => document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 660, 180, 700], ...value }))
      document.getPage(0).node.set(PDFName.of('Annots'), document.context.obj([
        link({ Dest: [document.getPage(2).ref, 'Fit'] }),
        link({ A: { S: 'URI', URI: PDFString.of('https://example.com/source') } }),
      ]))
    } else document.getPage(0).setRotation(degrees(90))
    return { name, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) }
  }
  const a = await fixture('A', 3, 'fronts.pdf'), b = await fixture('B', 2, 'backs.pdf')
  await writeFile('artifacts/Alternate_Mix_Fronts_Test.pdf', a.buffer)
  await writeFile('artifacts/Alternate_Mix_Backs_Test.pdf', b.buffer)
  const upload = (index, file) => page.locator(`.mix-upload-${index === 0 ? 'a' : 'b'} input[type=file]`).setInputFiles(file)
  const ready = () => page.waitForFunction(() => document.querySelectorAll('.mix-source-options').length === 2)
  const sequence = () => page.locator('.mix-sequence-list .mix-page-chip').allTextContents()
  const build = async () => {
    await page.getByRole('button', { name: /^(Mix PDFs|Rebuild preview)$/ }).click()
    await page.getByRole('heading', { name: 'Mixed PDF preview', exact: true }).waitFor()
    await page.locator('.mix-preview canvas[data-rendered-page="1"]').waitFor()
  }
  const download = async () => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const output = await pending
    return { name: output.suggestedFilename(), bytes: await readFile(await output.path()) }
  }
  const inspect = async bytes => page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib(), task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise, result = []
      for (let number = 1; number <= pdf.numPages; number++) {
        const source = await pdf.getPage(number), text = (await source.getTextContent()).items.map(item => item.str)
        const operators = await source.getOperatorList()
        const annotations = await source.getAnnotations()
        const internal = annotations.find(annotation => Array.isArray(annotation.dest))
        result.push({ label: text.find(text => /^[AB]\d+$/.test(text)) || '', text: text.join(' '), images: operators.fnArray.filter(op => op === pdfjs.OPS.paintImageXObject).length, target: internal ? await pdf.getPageIndex(internal.dest[0]) : null, external: annotations.find(annotation => annotation.url)?.url })
      }
      return result
    } finally { await task.destroy() }
  }, Array.from(bytes))

  await upload(0, a); await upload(1, b); await ready()
  assert.deepEqual(await sequence(), ['A1', 'B1', 'A2', 'B2', 'A3'])
  await build()
  const first = await download()
  assert.equal(first.name, 'alternate-mix.pdf')
  await writeFile('artifacts/Alternate_Mix_Result_Test.pdf', first.bytes)
  const firstPages = await inspect(first.bytes)
  assert.deepEqual(firstPages.map(page => page.label), ['A1', 'B1', 'A2', 'B2', 'A3'])
  assert.ok(firstPages.every(page => page.images === 1 && page.text.includes('Original selectable content')))
  assert.equal(firstPages[0].target, 4, 'Internal link did not follow the actual mixed page')
  assert.equal(firstPages[0].external, 'https://example.com/source')
  const geometry = (await PDFDocument.load(first.bytes)).getPages().map(page => ({ width: page.getWidth(), height: page.getHeight(), rotation: page.getRotation().angle }))
  assert.deepEqual(geometry.map(page => page.width), [595, 612, 842, 612, 300])
  assert.equal(geometry[1].rotation, 90)
  await page.screenshot({ path: 'artifacts/alternate-mix-preview.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Source A', exact: true }).click()
  await page.getByRole('heading', { name: 'Source PDF A', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Next preview page', exact: true }).click()
  await page.locator('.mix-preview canvas[data-rendered-page="2"]').waitFor()
  await page.getByLabel('Pages from PDF A', { exact: true }).fill('2-3')
  assert.deepEqual(await sequence(), ['A2', 'B1', 'A3', 'B2'])
  await page.getByRole('button', { name: 'Mixed PDF', exact: true }).click()
  assert.equal(await page.locator('.mix-preview canvas').count(), 0, 'Settings retained a stale result')
  await page.getByLabel('Reverse PDF B page order', { exact: true }).check()
  assert.deepEqual(await sequence(), ['A2', 'B2', 'A3', 'B1'])
  await page.getByLabel('Pages per turn from A', { exact: true }).selectOption('2')
  assert.deepEqual(await sequence(), ['A2', 'A3', 'B2', 'B1'])
  await page.getByLabel('Start with', { exact: true }).selectOption('1')
  assert.deepEqual(await sequence(), ['B2', 'A2', 'A3', 'B1'])
  const grouped = await download()
  assert.deepEqual((await inspect(grouped.bytes)).map(page => page.label), ['B2', 'A2', 'A3', 'B1'])
  await page.getByRole('button', { name: 'Scanned fronts & backs', exact: true }).click()
  assert.equal(await page.getByLabel('Pages from PDF A', { exact: true }).inputValue(), '2-3', 'Presets should retain the selected pages')
  assert.deepEqual(await sequence(), ['A2', 'B2', 'A3', 'B1'])
  await page.getByLabel('Pages from PDF A', { exact: true }).fill('')
  assert.deepEqual(await sequence(), ['A1', 'B2', 'A2', 'B1', 'A3'])
  await page.getByLabel('When one PDF runs out', { exact: true }).selectOption('blank')
  assert.deepEqual(await sequence(), ['A1', 'B2', 'A2', 'B1', 'A3', 'Blank'])
  await page.getByLabel('Rotate PDF B pages', { exact: true }).selectOption('180')
  await page.getByLabel('Output filename', { exact: true }).fill('front-back.pdf')
  const padded = await download()
  assert.equal(padded.name, 'front-back.pdf')
  assert.deepEqual((await inspect(padded.bytes)).map(page => page.label), ['A1', 'B2', 'A2', 'B1', 'A3', ''])
  const paddedPdf = await PDFDocument.load(padded.bytes)
  assert.equal(paddedPdf.getPage(3).getRotation().angle, 270)
  assert.deepEqual(paddedPdf.getPage(5).getSize(), paddedPdf.getPage(4).getSize())
  await page.getByRole('button', { name: 'Swap PDFs', exact: true }).click()
  assert.equal(await page.locator('.mix-source-a .file-item-name').textContent(), 'backs.pdf')
  assert.ok(await page.getByLabel('Reverse PDF A page order', { exact: true }).isChecked())
  const swapped = await download()
  assert.deepEqual((await inspect(swapped.bytes)).map(page => page.label), ['B2', 'A1', 'B1', 'A2', '', 'A3'])
  await page.getByLabel('Pages from PDF A', { exact: true }).fill('99')
  await page.getByRole('alert').filter({ hasText: 'PDF A: Choose pages between 1 and 2.' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled())
  await upload(0, { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.getByRole('alert').filter({ hasText: 'Choose a PDF file.' }).waitFor()
  await upload(0, { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await page.getByRole('alert').filter({ hasText: 'Could not read this PDF.' }).waitFor()
  await upload(0, { ...a, name: 'protected.pdf', buffer: Buffer.from(await encryptPDF(Uint8Array.from(a.buffer), 'test-password')) })
  await page.getByRole('alert').filter({ hasText: 'This PDF is password-protected.' }).waitFor()
  await page.getByRole('button', { name: 'Reset workspace', exact: true }).click()
  assert.equal(await page.locator('.mix-source .file-item').count(), 0)
  assert.equal(await page.locator('.mix-sequence-list').count(), 0)
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () { if (this.name === 'slow.pdf') await new Promise(resolve => setTimeout(resolve, 700)); return read.call(this) }
  })
  await upload(0, { ...a, name: 'slow.pdf' })
  await upload(0, { ...a, name: 'fast.pdf', mimeType: 'application/octet-stream' })
  await upload(1, b); await ready(); await page.waitForTimeout(900)
  assert.equal(await page.locator('.mix-source-a .file-item-name').textContent(), 'fast.pdf')
  assert.deepEqual(await sequence(), ['A1', 'B1', 'A2', 'B2', 'A3'])
  // Hold the engine at a cooperative yield to exercise an actual in-progress cancellation.
  await page.evaluate(() => { globalThis.originalMixTimeout = window.setTimeout; window.setTimeout = (callback, delay, ...args) => globalThis.originalMixTimeout(callback, delay === 0 ? 300 : delay, ...args) })
  await page.getByRole('button', { name: 'Mix PDFs', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel mixing', exact: true }).click()
  await page.evaluate(() => { window.setTimeout = globalThis.originalMixTimeout })
  await page.waitForTimeout(500)
  assert.equal(await page.getByRole('heading', { name: 'Mixed PDF preview', exact: true }).count(), 0)
  assert.equal(await page.getByRole('alert').count(), 0)
  await build()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => { scrollTo(0, 0); document.documentElement.setAttribute('data-theme', 'dark') })
  await page.screenshot({ path: 'artifacts/alternate-mix-dark-mobile.png', fullPage: true, animations: 'disabled' })
  await upload(0, { ...a, name: 'slow.pdf' })
  await page.getByRole('button', { name: 'Reset workspace', exact: true }).click()
  await page.waitForTimeout(900)
  assert.equal(await page.locator('.mix-source .file-item').count(), 0, 'A late file read restored a reset document')
  assert.deepEqual(errors, [])
  console.log('Alternate mix verified: live sequence, exact downloaded page order, unequal counts, ranges, reversed scans, block sizes, starting source, blanks, rotations, crop/size preservation, original text/images, internal and external links, source/result previews, filenames, swapping, file replacement, invalid/encrypted PDF recovery, cancellation, reset, mobile, and dark mode.')
} finally { await browser?.close(); server.kill() }
