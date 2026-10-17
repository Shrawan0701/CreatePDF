import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4191'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4191', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', data => { serverLog = (serverLog + data).slice(-4000) })
server.stderr.on('data', data => { serverLog = (serverLog + data).slice(-4000) })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt >= 120) throw new Error(`Vite did not start: ${serverLog}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Capture the PDF consumed by the preview without adding test state to the app.
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () {
      if (this.type === 'application/pdf') globalThis.previewPdfBlob = this
      return read.call(this)
    }
  })
  await page.goto(`${origin}/html-to-pdf`, { waitUntil: 'networkidle' })
  const waitForPage = async number => {
    await page.getByRole('img', { name: new RegExp(`^PDF preview page ${number} of`) }).waitFor()
    await page.waitForFunction(number => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === String(number), number)
    await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
  }
  await waitForPage(1)
  const markup = `<html><head><style>div { padding: 100px; }</style></head><body>
    <h1>Payment receipt</h1>
    <div><span>Customer</span></div>
    <div><span>Sample customer</span></div>
    <table><tr><th>Item</th><th>Amount</th></tr><tr><td>Application</td><td>294.00</td></tr></table>
    <section data-page-break="before"><h2>Second page</h2><p>Second page content.</p></section>
    <section data-page-break="before"><h2>Final page</h2><p>All content is visible.</p></section>
  </body></html>`
  await page.getByRole('textbox', { name: 'HTML source', exact: true }).fill(markup)
  await page.getByRole('textbox', { name: 'Header', exact: true }).fill('Receipt header')
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Page {page} of {total}')
  await page.getByRole('textbox', { name: 'PDF filename', exact: true }).fill('receipt-review.pdf')
  await page.getByText('Page 1 of 3', { exact: true }).waitFor()
  await waitForPage(1)
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await waitForPage(2)
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await waitForPage(3)
  assert.equal(await page.getByRole('button', { name: 'Next preview page' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Previous preview page' }).click()
  await waitForPage(2)
  await page.getByRole('combobox', { name: 'Preview zoom' }).selectOption('1.25')
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.pdf-preview-viewport canvas').style.width) - 595.28 * 1.25) < 3)
  await waitForPage(2)
  await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('landscape')
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-preview-viewport canvas')
    return canvas?.dataset.renderedPage === '1' && canvas.width > canvas.height
  })
  await waitForPage(1)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Create PDF', exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'receipt-review.pdf')
  const bytes = await readFile(await download.path())
  const preview = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))
  assert.deepEqual(Buffer.from(preview), bytes, 'The download must use the exact PDF shown in the preview')
  await page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise
      if (pdf.numPages !== 3) throw new Error('Incorrect page count')
      for (let index = 1; index <= pdf.numPages; index++) {
        const text = (await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str).join(' ')
        if (!text.includes('Receipt header') || !text.includes(`Page ${index} of 3`)) throw new Error('Header/footer page numbers differ from preview')
      }
    } finally { await task.destroy() }
  }, Array.from(bytes))
  // Edits made rapidly must replace stale preview jobs with the latest content.
  await page.getByRole('textbox', { name: 'HTML source', exact: true }).fill('<h1>Old edit</h1>')
  await page.getByRole('textbox', { name: 'HTML source', exact: true }).fill('<h1>Latest edit</h1>')
  await page.getByText('Page 1 of 1', { exact: true }).waitFor()
  await waitForPage(1)
  await page.evaluate(async () => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer()) })
    try {
      const pdf = await task.promise
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ')
      if (!text.includes('Latest edit') || text.includes('Old edit')) throw new Error('A stale edit replaced the latest preview')
    } finally { await task.destroy() }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: 'Preview zoom' }).selectOption('fit-page')
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-preview-viewport canvas')
    return canvas?.dataset.renderedPage === '1' && parseFloat(canvas.style.width) < 390
  })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Preview overflows the mobile page')
  await page.getByRole('textbox', { name: 'HTML source', exact: true }).fill('')
  await page.getByText('Your PDF pages will appear here.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Create PDF', exact: true }).isDisabled(), true)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'imported-receipt.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Imported receipt</h1><p>Imported content.</p>') })
  await waitForPage(1)
  assert.equal(await page.getByRole('textbox', { name: 'PDF filename', exact: true }).inputValue(), 'imported-receipt')
  if (process.argv[2]) {
    const html = await readFile(process.argv[2], 'utf8')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('portrait')
    await page.getByRole('textbox', { name: 'Header', exact: true }).fill('')
    await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('')
    await page.getByRole('textbox', { name: 'HTML source', exact: true }).fill(html)
    await waitForPage(1)
    await page.evaluate(async html => {
      const source = new DOMParser().parseFromString(html, 'text/html')
      const titles = [...source.querySelectorAll('.project-title')].slice(0, 2).map(element => element.textContent.trim())
      const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
      const pdfjs = await getPdfjsLib()
      const task = pdfjs.getDocument({ data: new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer()) })
      try {
        const pdf = await task.promise
        const items = []
        for (let index = 1; index <= pdf.numPages; index++) {
          for (const item of (await (await pdf.getPage(index)).getTextContent()).items) {
            if (item.str) items.push({ text: item.str, x: item.transform[4], y: item.transform[5], page: index })
          }
        }
        if (!items.some(item => item.text.includes('Backend Engineer'))) throw new Error('Animated hero content is missing')
        if (titles.length === 2) {
          const cards = titles.map(title => items.find(item => item.text.includes(title)))
          if (cards.some(card => !card) || cards[0].page !== cards[1].page || Math.abs(cards[0].y - cards[1].y) > 3 || cards[1].x - cards[0].x < 100) throw new Error('The uploaded desktop card grid was flattened')
        }
        const canvas = document.querySelector('.pdf-preview-viewport canvas')
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let dark = 0
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 80 && pixels[index + 1] < 80 && pixels[index + 2] < 80) dark++
        if (dark / (canvas.width * canvas.height) < 0.3) throw new Error('The uploaded page background was lost')
      } finally { await task.destroy() }
    }, html)
    if (process.env.HTML_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.HTML_PREVIEW_SCREENSHOT, fullPage: true })
    console.log('Uploaded HTML verified: desktop card grid, dark background, animation content, and complete PDF pages.')
  }
  assert.deepEqual(errors, [])
  console.log('HTML preview checks passed: exact PDF/download match, page navigation, zoom, orientation, headers/footers, rapid edits, import, empty state, and mobile layout.')
} finally {
  await browser?.close()
  server.kill()
}
