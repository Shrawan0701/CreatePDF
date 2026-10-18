import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4202'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4202', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite is starting. */ }
    if (attempt >= 120) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/pdf-to-html`, { waitUntil: 'networkidle' })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/pdf-html-empty.png', fullPage: true, animations: 'disabled' })
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80
    const context = canvas.getContext('2d'); context.fillStyle = '#0d7865'; context.fillRect(0, 0, 120, 80)
    context.fillStyle = '#ffffff'; context.font = 'bold 17px Arial'; context.fillText('PDF → HTML', 8, 45)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const image = await pdf.embedPng(Buffer.from(png, 'base64'))
  const first = pdf.addPage([595, 842])
  first.drawText('A report for the web', { x: 40, y: 790, size: 23, font: bold })
  first.drawRectangle({ x: 40, y: 770, width: 515, height: 2, color: rgb(.05, .47, .4) })
  first.drawText('Selectable text with original placement.', { x: 40, y: 740, size: 12, font: regular })
  first.drawText('A second line continues this paragraph.', { x: 40, y: 724, size: 12, font: regular })
  first.drawText('Open the report', { x: 40, y: 690, size: 12, font: regular })
  first.drawText('Go to page two', { x: 40, y: 665, size: 12, font: regular })
  first.drawText('<script>window.hacked=1</script>', { x: 40, y: 635, size: 10, font: regular })
  for (const [rowIndex, row] of [['Product', 'Quantity', 'Price'], ['Apple', '2', '12'], ['Pear', '3', '15']].entries()) row.forEach((text, column) => first.drawText(text, { x: 40 + column * 160, y: 590 - rowIndex * 22, size: 12, font: rowIndex === 0 ? bold : regular }))
  first.drawImage(image, { x: 40, y: 400, width: 120, height: 80 })
  const second = pdf.addPage([595, 842]); second.setRotation(degrees(90))
  second.drawText('Rotated landscape page', { x: 40, y: 750, size: 22, font: bold })
  second.drawText('Rotation and link placement remain aligned.', { x: 40, y: 710, size: 12, font: regular })
  const third = pdf.addPage([595, 842]); third.drawImage(image, { x: 40, y: 500, width: 480, height: 320 })
  const annotation = dictionary => pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', ...dictionary }))
  first.node.set(PDFName.of('Annots'), pdf.context.obj([
    annotation({ Rect: [40, 686, 140, 704], A: { S: 'URI', URI: PDFString.of('https://example.com/report?x=1&y=2') } }),
    annotation({ Rect: [40, 661, 140, 679], Dest: [second.ref, 'Fit'] }),
    annotation({ Rect: [40, 620, 150, 634], A: { S: 'URI', URI: PDFString.of('javascript:window.hacked=1') } }),
  ]))
  const file = { name: 'report & notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  const upload = source => page.locator('input[type=file]').setInputFiles(source || file)
  const convert = async () => {
    await page.getByRole('button', { name: 'Convert & preview', exact: true }).click()
    await page.getByRole('heading', { name: 'Your HTML is ready', exact: true }).waitFor()
    await page.frameLocator('iframe[title="Converted HTML preview"]').locator('main').waitFor()
  }
  const download = async (name = 'Download HTML') => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name, exact: true }).click()
    const output = await pending
    return { name: output.suggestedFilename(), bytes: await readFile(await output.path()) }
  }
  await upload()
  await page.getByLabel('HTML document title', { exact: true }).fill('My <report> & notes')
  await convert()
  let frame = page.frameLocator('iframe[title="Converted HTML preview"]')
  assert.equal(await frame.locator('.pdf-page').count(), 3)
  assert.equal(await frame.locator('.link-layer a').count(), 2)
  assert.equal(await frame.getByRole('link', { name: 'Go to page two', exact: true }).getAttribute('href'), '#page-2')
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('iframe').clientWidth <= 375)
  const mobilePreviewWidth = await page.locator('iframe').evaluate(frame => frame.clientWidth)
  assert.ok(mobilePreviewWidth <= 375)
  await page.screenshot({ path: 'artifacts/pdf-html-preview.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('tab', { name: 'HTML source', exact: true }).click()
  assert.ok((await page.locator('.html-export-code').textContent()).includes('[embedded image data]'))
  await page.getByRole('button', { name: 'Copy HTML', exact: true }).click()
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('data:image/png;base64,'))
  const single = await download()
  assert.equal(single.name, 'report & notes.html')
  assert.ok(single.bytes.toString().includes('My &lt;report&gt; &amp; notes'))
  await writeFile('artifacts/pdf-html-export.html', single.bytes)
  const output = await context.newPage()
  output.on('pageerror', error => errors.push(error.message))
  const remote = []
  output.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()) })
  await output.goto(pathToFileURL(resolve('artifacts/pdf-html-export.html')).href)
  await output.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await output.locator('.pdf-page').count(), 3)
  assert.equal(await output.title(), 'My <report> & notes')
  assert.equal(await output.evaluate(() => window.hacked), undefined)
  const pixelWidth = await output.locator('.pdf-page > img').first().evaluate(image => image.naturalWidth)
  assert.equal(pixelWidth, 1190)
  const selectedText = await output.locator('.text-layer').first().evaluate(layer => { const range = document.createRange(); range.selectNodeContents(layer); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString() })
  assert.ok(selectedText.includes('Selectable text with original placement.'))
  const alignment = await output.locator('.text-layer span').filter({ hasText: 'Selectable text with original placement.' }).evaluate(span => { const box = span.getBoundingClientRect(), page = span.closest('.pdf-page').getBoundingClientRect(); return { x: box.x - page.x, y: box.y - page.y, width: box.width } })
  assert.ok(Math.abs(alignment.x - 40) < 1)
  assert.ok(alignment.y > 85 && alignment.y < 103)
  assert.ok(alignment.width > 200 && alignment.width < 240)
  assert.equal(await output.getByRole('link', { name: 'Go to page two', exact: true }).getAttribute('href'), '#page-2')
  await output.getByRole('combobox', { name: 'Go to page', exact: true }).selectOption('2')
  await output.waitForFunction(() => window.scrollY > 300)
  await output.setViewportSize({ width: 390, height: 844 })
  await output.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
  await output.evaluate(() => scrollTo(0, 0))
  assert.deepEqual(remote, [], 'HTML requested remote assets')
  await output.screenshot({ path: 'artifacts/pdf-html-export-mobile.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('checkbox', { name: 'Package HTML and page images in a ZIP', exact: true }).check()
  const archive = await download('Download ZIP')
  assert.equal(archive.name, 'report & notes.zip')
  const zip = await JSZip.loadAsync(archive.bytes)
  assert.ok(zip.file('index.html')); assert.ok(zip.file('assets/page-1.png')); assert.ok(zip.file('assets/page-2.png')); assert.ok(zip.file('assets/page-3.png'))
  const packagedHtml = await zip.file('index.html').async('string')
  assert.ok(packagedHtml.includes('src="assets/page-1.png"'))
  assert.ok(!packagedHtml.includes('data:image/png;base64,'))
  for (const entry of Object.values(zip.files).filter(entry => !entry.dir)) {
    const target = resolve('artifacts/pdf-html-package', entry.name)
    await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, await entry.async('nodebuffer'))
  }
  await output.goto(pathToFileURL(resolve('artifacts/pdf-html-package/index.html')).href)
  await output.waitForFunction(() => document.images.length === 3 && [...document.images].every(image => image.complete && image.naturalWidth > 0))
  await page.getByRole('checkbox', { name: 'Include selectable text', exact: true }).uncheck()
  await page.getByLabel('Image resolution', { exact: true }).selectOption('1')
  await convert()
  frame = page.frameLocator('iframe[title="Converted HTML preview"]')
  assert.equal(await frame.locator('.text-layer span').count(), 0)
  assert.equal(await frame.locator('.pdf-page > img').first().evaluate(async image => { await image.decode(); return image.naturalWidth }), 595)
  // Responsive text mode exports real, readable HTML with headings, tables and images.
  await page.getByRole('radio', { name: /Responsive reading layout/ }).check()
  await page.getByRole('checkbox', { name: 'Package HTML and page images in a ZIP', exact: true }).uncheck()
  await convert()
  frame = page.frameLocator('iframe[title="Converted HTML preview"]')
  assert.ok((await frame.locator('.reading-page h2').first().textContent()).includes('A report for the web'))
  assert.equal(await frame.locator('#page-2 h2').textContent(), 'Rotated landscape page')
  assert.equal(await frame.locator('.reading-page table').count(), 1)
  assert.ok(await frame.getByRole('cell', { name: 'Apple', exact: true }).isVisible())
  assert.equal(await frame.locator('.reading-page figure img').count(), 1)
  assert.equal(await frame.locator('.scan-page').count(), 1)
  assert.equal(await frame.locator('.text-layer').count(), 0)
  await page.getByRole('checkbox', { name: 'Package HTML and page images in a ZIP', exact: true }).check()
  const readingZip = await JSZip.loadAsync((await download('Download ZIP')).bytes)
  const readingIndex = await readingZip.file('index.html').async('string')
  assert.ok(readingIndex.includes('assets/page-1-image-1.png'))
  assert.ok(readingZip.file('assets/page-1-image-1.png'))
  assert.ok(readingZip.file('assets/page-3.png'))
  assert.ok(!readingZip.file('assets/page-1.png'), 'Reading ZIP unnecessarily included a text-page screenshot')
  await page.getByRole('checkbox', { name: 'Package HTML and page images in a ZIP', exact: true }).uncheck()
  const reading = await download()
  await writeFile('artifacts/pdf-html-reading.html', reading.bytes)
  await output.goto(pathToFileURL(resolve('artifacts/pdf-html-reading.html')).href)
  assert.equal(await output.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await output.locator('script').count(), 1, 'PDF text injected an executable script')
  assert.equal(await output.evaluate(() => window.hacked), undefined)
  await page.getByRole('checkbox', { name: 'Keep clickable links', exact: true }).uncheck()
  await convert()
  assert.equal(await frame.locator('a').count(), 0)
  await page.getByRole('checkbox', { name: 'Include embedded images', exact: true }).uncheck()
  await convert()
  assert.equal(await frame.locator('figure img').count(), 0)
  assert.equal(await frame.locator('.scan-page').count(), 1, 'Disabling embedded pictures dropped scanned pages')
  await page.getByLabel('Pages', { exact: true }).fill('2')
  await convert()
  assert.equal(await frame.locator('.reading-page').count(), 1)
  assert.equal(await frame.locator('#page-2').count(), 1)
  await page.getByLabel('Pages', { exact: true }).fill('99')
  await page.getByRole('button', { name: 'Convert & preview', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Choose pages between 1 and 3.' }).waitFor()
  await upload({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await page.getByRole('button', { name: 'Convert & preview', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Could not read this PDF' }).waitFor()
  const encrypted = { ...file, name: 'protected.pdf', buffer: Buffer.from(await encryptPDF(Uint8Array.from(file.buffer), 'sample-password')) }
  await upload(encrypted)
  await page.getByRole('button', { name: 'Convert & preview', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Enter the correct PDF opening password' }).waitFor()
  await page.getByText('Password-protected PDF?', { exact: true }).click()
  await page.getByLabel('PDF opening password', { exact: true }).fill('sample-password')
  await convert()
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () { if (this.name === 'slow.pdf') await new Promise(resolve => setTimeout(resolve, 700)); return read.call(this) }
  })
  await upload({ ...file, name: 'slow.pdf' })
  await page.getByRole('button', { name: 'Convert & preview', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel conversion', exact: true }).click()
  await page.waitForTimeout(900)
  assert.equal(await page.getByRole('heading', { name: 'Your HTML is ready', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Remove slow.pdf', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Download HTML', exact: true }).isDisabled())
  await upload(); await convert()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => { scrollTo(0, 0); document.documentElement.setAttribute('data-theme', 'dark') })
  await page.screenshot({ path: 'artifacts/pdf-html-dark-mobile.png', fullPage: true, animations: 'disabled' })
  assert.deepEqual(errors, [])
  console.log('PDF to HTML verified: actual preview and downloads, selectable text geometry, rotated pages, safe external/internal links, offline single HTML and ZIP assets, mobile page fitting, real reading text/headings/tables/images, scan fallback, options, copy, password support, cancellation, recovery, and dark mode.')
} finally { await browser?.close(); server.kill() }
