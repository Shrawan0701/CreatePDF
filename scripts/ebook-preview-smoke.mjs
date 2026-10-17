import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4197'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4197', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite starting. */ }
    if (attempt >= 120) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () { if (this.type === 'application/pdf') globalThis.previewPdfBlob = this; return original.call(this) }
  })
  await page.goto(`${origin}/ebook-to-pdf`, { waitUntil: 'networkidle' })
  assert.ok(await page.getByRole('button', { name: 'Download PDF' }).isDisabled())
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.pdf-document-preview')?.getAttribute('aria-busy') === 'false' && document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
    assert.equal(await page.locator('.pdf-preview-error').count(), 0)
  }
  const download = async () => {
    await ready()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const file = await pending
    const bytes = await readFile(await file.path())
    const preview = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))
    assert.deepEqual(bytes, Buffer.from(preview))
    return page.evaluate(async bytes => {
      const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
      const pdfjs = await getPdfjsLib()
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
      try {
        const pdf = await task.promise
        const pages = []
        for (let index = 1; index <= pdf.numPages; index++) {
          const page = await pdf.getPage(index)
          const operators = await page.getOperatorList()
          pages.push({ text: (await page.getTextContent()).items.map(item => item.str).join(' '), width: page.view[2], height: page.view[3], images: operators.fnArray.filter(op => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject].includes(op)).length, links: (await page.getAnnotations()).map(annotation => annotation.url) })
        }
        return pages
      } finally { await task.destroy() }
    }, Array.from(bytes))
  }
  const zip = new JSZip()
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>')
  zip.file('OPS/book.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Test Book</dc:title><dc:creator>Example Author</dc:creator></metadata><manifest><item id="two" href="two.xhtml"/><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>')
  zip.file('OPS/one.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>First Chapter</h1><p>A <strong>bold phrase</strong> and <a href="https://example.com/book">reference link</a>.</p><img src="images/cover.png" width="48" height="48"/><script>window.ebookScriptRan=true</script></body></html>')
  zip.file('OPS/two.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Second Chapter</h1><p>LAST_CHAPTER_MARKER</p><ul><li>A reading note</li></ul></body></html>')
  zip.file('OPS/images/cover.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', 'base64'))
  await page.locator('input[type=file]').setInputFiles({ name: 'test-book.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) })
  await page.getByText('Example Author', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Book title', exact: true }).inputValue(), 'Test Book')
  let pages = await download()
  assert.equal(pages.length, 2)
  assert.ok(pages[0].text.includes('First Chapter') && pages[1].text.includes('Second Chapter'))
  assert.equal(pages[0].images, 1)
  assert.ok(pages[0].links.includes('https://example.com/book'))
  assert.equal(await page.evaluate(() => globalThis.ebookScriptRan), undefined)
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '2')
  await page.getByRole('checkbox', { name: 'Start each EPUB chapter on a new page' }).uncheck()
  pages = await download()
  assert.equal(pages.length, 1)
  assert.ok(pages[0].text.includes('LAST_CHAPTER_MARKER'))
  const text = Array.from({ length: 65 }, (_, index) => `Paragraph ${index + 1}. This is a test paragraph for a readable book with automatic page breaks and selectable text.`).join('\n\n')
  await page.locator('input[type=file]').setInputFiles({ name: 'reading-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  await page.getByRole('textbox', { name: 'Book title', exact: true }).waitFor()
  await page.getByRole('combobox', { name: 'Page size' }).selectOption('Letter')
  await page.getByRole('combobox', { name: 'Orientation' }).selectOption('landscape')
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Page {page} of {total}')
  pages = await download()
  assert.ok(pages.length > 1)
  assert.equal(pages[0].width, 792)
  assert.equal(pages[0].height, 612)
  assert.ok(pages.at(-1).text.includes('Paragraph 65.') && pages.at(-1).text.includes(`Page ${pages.length} of ${pages.length}`))
  await page.getByText('Edit book content', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Book content', exact: true }).fill('Corrected book text')
  pages = await download()
  assert.ok(pages[0].text.includes('Corrected book text') && !pages[0].text.includes('Paragraph 65.'))
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await page.locator('input[type=file]').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') })
  await page.getByRole('alert').filter({ hasText: 'This text file is empty.' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('eBook checks passed: EPUB order, images, links, sanitization, chapter breaks, TXT pagination, layout, editing, preview/download parity, mobile, and empty files.')
} finally {
  await browser?.close()
  server.kill()
}
