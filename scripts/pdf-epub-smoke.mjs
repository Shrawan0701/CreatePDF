import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4203'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4203', '--strictPort'], { stdio: 'ignore' })
const validator = process.env.EPUBCHECK_JAR || join(tmpdir(), 'createpdf-epubcheck', 'epubcheck-5.4.0', 'epubcheck.jar')
let hasValidator = true
try { await access(validator) } catch { hasValidator = false }
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
  await page.goto(`${origin}/pdf-to-epub`, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('input[type=password]').count(), 0, 'Password field must not exist until requested')
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/pdf-epub-empty.png', fullPage: true, animations: 'disabled' })
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80
    const context = canvas.getContext('2d'); context.fillStyle = '#0d7865'; context.fillRect(0, 0, 120, 80)
    context.fillStyle = 'white'; context.font = '18px Arial'; context.fillText('Book image', 10, 45)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const image = await pdf.embedPng(Buffer.from(png, 'base64'))
  const first = pdf.addPage([595, 842])
  first.drawText('A better reading experience', { x: 40, y: 790, size: 23, font: bold })
  first.drawText('A paragraph that should read naturally.', { x: 40, y: 745, size: 12, font: regular })
  first.drawText('This second line continues the paragraph.', { x: 40, y: 729, size: 12, font: regular })
  first.drawText('Open the report', { x: 40, y: 690, size: 12, font: regular })
  first.drawText('Next chapter', { x: 40, y: 665, size: 12, font: regular })
  first.drawText('<script>window.injected=1</script>', { x: 40, y: 635, size: 10, font: regular })
  for (const [rowIndex, row] of [['Product', 'Quantity', 'Price'], ['Apple', '2', '12'], ['Pear', '3', '15']].entries()) row.forEach((text, column) => first.drawText(text, { x: 40 + column * 160, y: 590 - rowIndex * 22, size: 12, font: rowIndex === 0 ? bold : regular }))
  first.drawImage(image, { x: 40, y: 400, width: 120, height: 80 })
  const second = pdf.addPage([595, 842]); second.setRotation(degrees(90))
  second.drawText('A rotated chapter', { x: 40, y: 780, size: 22, font: bold })
  second.drawText('Reading order follows the text.', { x: 40, y: 740, size: 12, font: regular })
  second.drawImage(image, { x: 40, y: 500, width: 120, height: 80 })
  const third = pdf.addPage([595, 842]); third.drawImage(image, { x: 40, y: 500, width: 480, height: 320 })
  third.drawRectangle({ x: 40, y: 480, width: 480, height: 2, color: rgb(.1, .4, .3) })
  const annotation = dictionary => pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', ...dictionary }))
  first.node.set(PDFName.of('Annots'), pdf.context.obj([
    annotation({ Rect: [40, 686, 140, 704], A: { S: 'URI', URI: PDFString.of('https://example.com/report?x=1&y=2') } }),
    annotation({ Rect: [40, 661, 140, 679], Dest: [second.ref, 'Fit'] }),
    annotation({ Rect: [40, 620, 150, 634], A: { S: 'URI', URI: PDFString.of('javascript:window.injected=1') } }),
  ]))
  const source = { name: 'book & notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  const upload = file => page.locator('.epub-pdf-upload input[type=file]').setInputFiles(file || source)
  const convert = async () => {
    await page.getByRole('button', { name: 'Create & preview EPUB', exact: true }).click()
    await page.getByRole('heading', { name: 'Your book is ready', exact: true }).waitFor()
    await page.frameLocator('iframe[title="EPUB book preview"]').locator('body').waitFor()
  }
  const download = async name => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download EPUB', exact: true }).click()
    const output = await pending
    assert.equal(output.suggestedFilename(), 'book & notes.epub')
    const bytes = await readFile(await output.path())
    assert.equal(bytes.readUInt16LE(8), 0, 'EPUB mimetype must be uncompressed')
    assert.equal(bytes.subarray(30, 38).toString(), 'mimetype')
    await writeFile(`artifacts/${name}.epub`, bytes)
    return JSZip.loadAsync(bytes)
  }
  const inspect = async zip => {
    const sources = await Promise.all(Object.values(zip.files).filter(entry => /\.(xhtml|opf|xml|ncx)$/.test(entry.name)).map(async entry => ({ path: entry.name, source: await entry.async('string') })))
    const problems = await page.evaluate(({ sources, names }) => {
      const problems = [], paths = new Set(names)
      const documents = new Map()
      for (const { path, source } of sources) {
        const doc = new DOMParser().parseFromString(source, 'application/xml')
        if (doc.querySelector('parsererror')) problems.push(`Malformed XML: ${path}: ${doc.querySelector('parsererror').textContent}`)
        documents.set(path, doc)
      }
      for (const [path, doc] of documents) {
        const ids = new Set()
        for (const element of doc.querySelectorAll('[id]')) { const id = element.getAttribute('id'); if (ids.has(id)) problems.push(`Duplicate ID ${id} in ${path}`); ids.add(id) }
        for (const element of doc.querySelectorAll('[href],[src]')) {
          const href = element.getAttribute('href') || element.getAttribute('src')
          if (/^(https?:|mailto:|tel:)/.test(href)) continue
          const resolved = new URL(href, `https://epub.local/${path}`)
          const target = resolved.pathname.slice(1)
          if (!paths.has(target)) problems.push(`Missing resource ${href} in ${path}`)
          if (resolved.hash && !documents.get(target)?.getElementById(decodeURIComponent(resolved.hash.slice(1)))) problems.push(`Missing anchor ${href} in ${path}`)
        }
      }
      return problems
    }, { sources, names: Object.keys(zip.files) })
    assert.deepEqual(problems, [])
  }
  const validate = name => {
    if (!hasValidator) return
    const report = execFileSync('java', ['-jar', validator, resolve(`artifacts/${name}.epub`)], { encoding: 'utf8', timeout: 60000 })
    console.log(`${name}: ${report.trim()}`)
  }
  await upload()
  await page.getByLabel('Book title', { exact: true }).fill('A <book> & notes')
  await page.getByLabel('Author', { exact: true }).fill('Jane & Joe')
  await page.getByLabel('Reading font', { exact: true }).selectOption('sans-serif')
  await page.getByLabel('Text size (%)', { exact: true }).fill('120')
  await page.getByLabel('Line spacing', { exact: true }).fill('1.8')
  await convert()
  const frame = page.frameLocator('iframe[title="EPUB book preview"]')
  assert.equal(await page.getByRole('combobox', { name: 'Book section', exact: true }).inputValue(), 'cover')
  assert.ok(await frame.getByRole('img', { name: 'A <book> & notes by Jane & Joe', exact: true }).isVisible())
  await page.getByRole('button', { name: 'Next book section', exact: true }).click()
  await frame.getByRole('heading', { name: 'Contents', exact: true }).waitFor()
  await frame.getByRole('link', { name: /Page 1: A better reading experience/ }).click()
  await frame.getByRole('heading', { name: 'A better reading experience', exact: true }).waitFor()
  assert.equal(await frame.getByRole('cell', { name: 'Apple', exact: true }).count(), 1)
  assert.equal(await frame.locator('figure img').count(), 1)
  assert.equal(await frame.locator('script').count(), 1, 'PDF text injected a script')
  await frame.getByRole('link', { name: 'Next chapter', exact: true }).click()
  await frame.getByRole('heading', { name: 'A rotated chapter', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sepia reader theme', exact: true }).click()
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(244, 234, 212)')
  await page.getByRole('button', { name: 'Night reader theme', exact: true }).click()
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(23, 35, 30)')
  await page.getByRole('button', { name: 'Paper reader theme', exact: true }).click()
  await page.getByRole('button', { name: 'Mobile book preview', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('iframe').clientWidth <= 375)
  await page.getByRole('combobox', { name: 'Book section', exact: true }).selectOption('page-1')
  await page.screenshot({ path: 'artifacts/pdf-epub-preview.png', fullPage: true, animations: 'disabled' })
  const epub = await download('pdf-epub-reflow')
  await inspect(epub); validate('pdf-epub-reflow')
  const opf = await epub.file('EPUB/content.opf').async('string')
  assert.ok(opf.includes('<dc:title>A &lt;book&gt; &amp; notes</dc:title>'))
  assert.ok(opf.includes('<dc:creator>Jane &amp; Joe</dc:creator>'))
  assert.ok(opf.includes('properties="cover-image"'))
  assert.ok(opf.includes('rendition:layout">reflowable'))
  assert.ok(epub.file('EPUB/toc.ncx'))
  assert.ok((await epub.file('EPUB/styles.css').async('string')).includes('font-size:120%;line-height:1.8'))
  const chapter = await epub.file('EPUB/page-1.xhtml').async('string')
  assert.ok(chapter.includes('page-2.xhtml#page-2'))
  assert.ok(!chapter.includes('javascript:'))
  assert.ok(chapter.includes('<table>'))
  assert.equal(Object.values(epub.files).filter(entry => /EPUB\/images\/.*\.png$/.test(entry.name)).length, 1, 'Repeated images were not deduplicated across chapters')
  assert.ok(epub.file('EPUB/page-3.png'))
  // Custom covers and optional content must be reflected in both the archive and preview.
  await page.getByText('Cover & export options', { exact: true }).click()
  await page.locator('.epub-cover-upload input[type=file]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.getByLabel('Book description', { exact: true }).fill('A useful <description> & more')
  await convert()
  const custom = await download('pdf-epub-custom-cover')
  const dimensions = await page.evaluate(async base64 => { const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob()); return [image.width, image.height] }, await custom.file('EPUB/cover.png').async('base64'))
  assert.deepEqual(dimensions, [120, 80])
  assert.ok((await custom.file('EPUB/content.opf').async('string')).includes('A useful &lt;description&gt; &amp; more'))
  await page.getByLabel('Add a book cover', { exact: true }).uncheck()
  await page.getByLabel('Include embedded images', { exact: true }).uncheck()
  await page.getByLabel('Keep clickable links', { exact: true }).uncheck()
  await page.getByLabel('Pages', { exact: true }).fill('1')
  const selected = await download('pdf-epub-selection')
  assert.ok(!selected.file('EPUB/cover.png'))
  assert.ok(!selected.file('EPUB/page-2.xhtml'))
  assert.equal(Object.keys(selected.files).filter(path => path.endsWith('.png')).length, 0)
  assert.ok(!(await selected.file('EPUB/page-1.xhtml').async('string')).includes('<a '))
  await inspect(selected); validate('pdf-epub-selection')
  // Fixed pages preserve original page dimensions and links, with an image per page.
  await page.getByLabel('Pages', { exact: true }).fill('')
  await page.getByLabel('Keep clickable links', { exact: true }).check()
  await page.getByLabel('Add a book cover', { exact: true }).check()
  await page.getByLabel('Reading layout', { exact: true }).selectOption('pages')
  await convert()
  await page.getByRole('combobox', { name: 'Book section', exact: true }).selectOption('page-2')
  await frame.getByRole('img', { name: 'PDF page 2', exact: true }).waitFor()
  assert.equal(await frame.locator('html').evaluate(html => html.scrollWidth > innerWidth), false)
  const fixed = await download('pdf-epub-fixed')
  await inspect(fixed); validate('pdf-epub-fixed')
  assert.ok((await fixed.file('EPUB/content.opf').async('string')).includes('rendition:layout">pre-paginated'))
  assert.ok((await fixed.file('EPUB/page-2.xhtml').async('string')).includes('content="width=842,height=595"'))
  for (const number of [1, 2, 3]) assert.ok(fixed.file(`EPUB/page-${number}.png`))
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => { scrollTo(0, 0); document.documentElement.setAttribute('data-theme', 'dark') })
  await page.screenshot({ path: 'artifacts/pdf-epub-dark-mobile.png', fullPage: true, animations: 'disabled' })
  // Input errors, password handling, cancellation and stale-result prevention.
  await page.getByLabel('Pages', { exact: true }).fill('99')
  await page.getByRole('button', { name: 'Create & preview EPUB', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Choose pages between 1 and 3.' }).waitFor()
  await upload({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await page.getByRole('button', { name: 'Create & preview EPUB', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Could not read this PDF' }).waitFor()
  const protectedFile = { ...source, name: 'protected.pdf', buffer: Buffer.from(await encryptPDF(Uint8Array.from(source.buffer), 'sample-password')) }
  await upload(protectedFile)
  await page.getByRole('button', { name: 'Create & preview EPUB', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Enter the correct PDF opening password' }).waitFor()
  await page.getByRole('checkbox', { name: 'This PDF needs an opening password', exact: true }).check()
  assert.equal(await page.getByLabel('PDF opening password', { exact: true }).inputValue(), '')
  await page.getByLabel('PDF opening password', { exact: true }).fill('sample-password')
  await convert()
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () { if (this.name === 'slow.pdf') await new Promise(resolve => setTimeout(resolve, 700)); return read.call(this) }
  })
  await upload({ ...source, name: 'slow.pdf' })
  assert.equal(await page.locator('input[type=password]').count(), 0, 'Choosing another PDF must clear and hide its password')
  await page.getByRole('button', { name: 'Create & preview EPUB', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel conversion', exact: true }).click()
  await page.waitForTimeout(900)
  assert.equal(await page.getByRole('heading', { name: 'Your book is ready', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Remove slow.pdf', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Download EPUB', exact: true }).isDisabled())
  assert.deepEqual(errors, [])
  console.log(`EPUB verified: reading text, tables, images and deduplication, metadata, generated/custom covers, safe links, contents/reader navigation, themes, fixed layout, resource/anchor integrity, page selection, scan fallback, passwords, cancellation, mobile, and dark mode. EPUBCheck ${hasValidator ? 'passed for reflow, selection, and fixed-layout books' : 'not installed; set EPUBCHECK_JAR for conformance validation'}.`)
} finally { await browser?.close(); server.kill() }
