import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4192'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4192', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt >= 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  const apiCalls = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/')) apiCalls.push(request.url()) })
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () {
      if (this.type === 'application/pdf') globalThis.previewPdfBlob = this
      return read.call(this)
    }
  })
  await page.goto(`${origin}/create-pdf`, { waitUntil: 'networkidle' })
  const editor = page.getByRole('textbox', { name: 'Document content', exact: true })
  assert.equal(await page.getByText('Import document', { exact: true }).count(), 0)
  assert.equal(await editor.innerText(), '\n')
  assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true)
  await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Project notes')
  await page.getByRole('combobox', { name: 'Document font', exact: true }).selectOption('serif')
  await page.getByRole('spinbutton', { name: 'Document font size (pt)', exact: true }).fill('14')
  await editor.click()
  await page.keyboard.type('Project heading')
  await page.getByRole('combobox', { name: 'Text style' }).selectOption('h1')
  await page.getByRole('button', { name: 'Align center', exact: true }).click()
  assert.equal(await editor.locator('h1').innerText(), 'Project heading')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('combobox', { name: 'Text style' }).selectOption('p')
  await page.getByRole('button', { name: 'Align left', exact: true }).click()
  await page.keyboard.type('Normal text ')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.type('Bold marker')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.type(' ')
  await page.getByRole('button', { name: 'Italic', exact: true }).click()
  await page.keyboard.type('Italic marker')
  await page.getByRole('button', { name: 'Italic', exact: true }).click()
  await page.keyboard.type(' ')
  await page.getByRole('button', { name: 'Underline', exact: true }).click()
  await page.keyboard.type('Underline marker')
  await page.getByRole('button', { name: 'Underline', exact: true }).click()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Insert link', exact: true }).click()
  await page.getByRole('textbox', { name: 'Link text', exact: true }).fill('Project website')
  await page.getByRole('textbox', { name: 'Link address', exact: true }).fill('https://example.com/project')
  await page.getByRole('button', { name: 'Add link', exact: true }).click()
  assert.equal(await editor.locator('a').getAttribute('href'), 'https://example.com/project')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Insert table', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Body rows', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('2')
  await page.getByRole('button', { name: 'Add table', exact: true }).click()
  assert.equal(await editor.locator('table tr').count(), 3)
  assert.equal(await editor.locator('table tr').first().locator('th').count(), 2)
  await editor.locator('td').first().fill('Editable cell')
  await editor.press('Control+End')
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 32
    const context = canvas.getContext('2d')
    context.fillStyle = '#167c67'
    context.fillRect(0, 0, 64, 32)
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 32)
    context.fillStyle = '#0000ff'; context.fillRect(48, 0, 16, 32)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'local-image.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
  await editor.locator('img').waitFor()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await editor.locator('img').count(), 0, 'Image insertion cannot be undone')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await editor.locator('img').click()
  await page.getByRole('spinbutton', { name: 'Image width (%)', exact: true }).fill('40')
  await page.getByRole('button', { name: 'Apply size', exact: true }).click()
  assert.equal(await editor.locator('img').getAttribute('data-image-width'), '40')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await editor.locator('img').getAttribute('data-image-width'), '100', 'Image resize cannot be undone')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await editor.locator('img').click()
  await page.getByRole('combobox', { name: 'Image alignment', exact: true }).selectOption('right')
  await page.getByRole('button', { name: 'Crop image', exact: true }).click()
  await page.getByRole('slider', { name: 'Crop left (%)', exact: true }).fill('25')
  await page.getByRole('slider', { name: 'Crop right (%)', exact: true }).fill('25')
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.create-document-editor img')?.naturalWidth === 32)
  assert.equal(await editor.locator('img').evaluate(image => image.naturalHeight), 32)
  const croppedSource = await editor.locator('img').getAttribute('src')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.create-document-editor img')?.naturalWidth === 64)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await editor.locator('img').getAttribute('src'), croppedSource, 'Redo did not restore the crop')
  await editor.locator('img').click()
  const position = () => editor.locator('img').evaluate(image => { let block = image; while (block.parentElement !== document.querySelector('.create-document-editor')) block = block.parentElement; return [...block.parentNode.childNodes].indexOf(block) })
  const imagePosition = await position()
  await page.getByRole('button', { name: 'Move image up', exact: true }).click()
  assert.equal(await position(), imagePosition - 1, 'Image did not move up')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await position(), imagePosition, 'Image move cannot be undone')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await editor.locator('img').click()
  await page.getByRole('button', { name: 'Remove image', exact: true }).click()
  assert.equal(await editor.locator('img').count(), 0)
  await editor.press('Control+z')
  assert.equal(await editor.locator('img').getAttribute('src'), croppedSource, 'Image removal cannot be undone')
  assert.ok((await editor.innerText()).includes('Editable cell'), 'Image editing removed table content from the editor')
  const editorFonts = await editor.evaluate(element => ({ heading: getComputedStyle(element.querySelector('h1')).fontFamily, body: getComputedStyle(element.querySelector('p')).fontFamily, size: parseFloat(getComputedStyle(element.querySelector('h1')).fontSize) }))
  assert.equal(editorFonts.heading, editorFonts.body, 'Document font did not apply to headings')
  assert.ok(Math.abs(editorFonts.size - 14 * 4 / 3 * 2) < .1, 'Heading did not scale with document size')
  await editor.locator('p').first().click()
  const originalBlocks = await editor.evaluate(element => [...element.children].map(child => child.textContent))
  await page.getByRole('button', { name: 'Move block down', exact: true }).click()
  assert.notDeepEqual(await editor.evaluate(element => [...element.children].map(child => child.textContent)), originalBlocks, 'Paragraph did not move')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual(await editor.evaluate(element => [...element.children].map(child => child.textContent)), originalBlocks, 'Paragraph move cannot be undone')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: 'Move block up', exact: true }).click()
  assert.deepEqual(await editor.evaluate(element => [...element.children].map(child => child.textContent)), originalBlocks, 'Paragraph did not move back')
  await editor.press('Control+End')
  await page.getByRole('button', { name: 'Insert page break', exact: true }).click()
  await page.keyboard.type('Second page content')
  const beforeUndo = await editor.innerHTML()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.notEqual(await editor.innerHTML(), beforeUndo, 'Undo did not change the document')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await editor.innerHTML(), beforeUndo, 'Redo did not restore the document')
  const selectText = async (value, start = 0, length = value.length) => {
    await editor.evaluate((element, { value, start, length }) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.includes(value)) continue
        const node = walker.currentNode
        const offset = node.textContent.indexOf(value) + start
        const range = document.createRange()
        range.setStart(node, offset); range.setEnd(node, offset + length)
        element.focus()
        const selection = window.getSelection()
        selection.removeAllRanges(); selection.addRange(range)
        return
      }
      throw new Error(`Missing selection text ${value}`)
    }, { value, start, length })
    await page.getByRole('combobox', { name: 'Selected text font', exact: true }).waitFor()
  }
  await selectText('Bold marker')
  await page.getByRole('combobox', { name: 'Selected text font', exact: true }).selectOption('sans-serif')
  await page.getByRole('combobox', { name: 'Selected text size (pt)', exact: true }).selectOption('18')
  assert.equal(await editor.locator('[data-text-size="18"]').innerText(), 'Bold marker')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await editor.locator('[data-text-size="18"]').count(), 0, 'Selection font size cannot be undone')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await editor.locator('[data-text-size="18"]').innerText(), 'Bold marker')
  await selectText('Editable cell', 0, 8)
  await page.getByRole('combobox', { name: 'Selected text font', exact: true }).selectOption('sans-serif')
  await page.getByRole('combobox', { name: 'Selected text size (pt)', exact: true }).selectOption('16')
  assert.equal(await editor.locator('td [data-text-size="16"]').innerText(), 'Editable', 'Formatting changed more than the selected table text')
  await page.getByText('Page 1 of 2', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')

  await page.locator('.create-page-settings summary').click()
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Page {page} of {total}')
  await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const download = await pending
  assert.equal(download.suggestedFilename(), 'Project notes.pdf')
  const bytes = await readFile(await download.path())
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
  const preview = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))
  assert.deepEqual(Buffer.from(preview), bytes, 'Download differs from the PDF shown in preview')
  await page.evaluate(async bytes => {
    const { getPdfjsLib, getPdfLib } = await import('/src/services/pdfEngine.js')
    const { PDFDocument } = await getPdfLib()
    const document = await PDFDocument.load(new Uint8Array(bytes))
    const fontDictionary = document.context.lookup(document.getPage(0).node.Resources().entries().find(([key]) => key.toString() === '/Font')[1])
    const fontNames = fontDictionary.entries().map(([, ref]) => document.context.lookup(ref).entries().find(([key]) => key.toString() === '/BaseFont')?.[1].toString())
    if (!['/Times-Roman', '/Times-Bold', '/Times-Italic'].every(name => fontNames.includes(name))) throw new Error(`Document font did not apply to body and headings: ${fontNames}`)
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise
      if (pdf.numPages !== 2) throw new Error('Manual page break did not produce two pages')
      const first = await pdf.getPage(1)
      const content = await first.getTextContent()
      const text = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ')
      for (const value of ['Project heading', 'Normal text', 'Bold marker', 'Italic marker', 'Underline marker', 'Project website', 'Editable cell', 'Page 1 of 2']) {
        if (!text.includes(value)) throw new Error(`PDF lost ${value}: ${text}`)
      }
      const fonts = ['Normal text', 'Bold marker', 'Italic marker'].map(value => content.items.find(item => item.str.includes(value))?.fontName)
      if (fonts.some(font => !font) || new Set(fonts).size !== 3) throw new Error('Inline formatting affected the entire paragraph')
      const title = content.items.find(item => item.str.includes('Project heading'))
      if (Math.abs(title.transform[0] - 28) > .1) throw new Error('PDF heading did not scale with document font size')
      if (Math.abs(content.items.find(item => item.str.includes('Normal text')).transform[0] - 14) > .1) throw new Error('PDF body has the wrong document font size')
      if (Math.abs(content.items.find(item => item.str.includes('Bold marker')).transform[0] - 18) > .1) throw new Error('PDF lost selected text size')
      if (Math.abs(content.items.find(item => item.str.includes('Editable')).transform[0] - 16) > .1) throw new Error('PDF lost selected table text size')
      if (Math.abs(content.items.find(item => item.str.trim() === 'cell').transform[0] - 14) > .1) throw new Error('PDF changed unselected table text size')
      if (Math.abs(title.transform[4] + title.width / 2 - 595 / 2) > 2) throw new Error('Centered heading was not centered in PDF')
      if (!(await first.getAnnotations()).some(annotation => annotation.url === 'https://example.com/project')) throw new Error('Link was not clickable in PDF')
      const operators = await first.getOperatorList()
      const imageIndex = operators.fnArray.indexOf(pdfjs.OPS.paintImageXObject)
      if (imageIndex < 0) throw new Error('Inserted image was lost')
      let matrix = [1, 0, 0, 1, 0, 0]
      const stack = []
      for (let index = 0; index < imageIndex; index++) {
        const op = operators.fnArray[index]
        if (op === pdfjs.OPS.save) stack.push([...matrix])
        if (op === pdfjs.OPS.restore) matrix = stack.pop()
        if (op === pdfjs.OPS.transform) {
          const [a, b, c, d, e, f] = matrix
          const [g, h, i, j, k, l] = operators.argsArray[index]
          matrix = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]
        }
      }
      if (!matrix || Math.abs(matrix[0] - 201.2) > .1 || Math.abs(matrix[3] - 201.2) > .1 || Math.abs(matrix[4] - 347.8) > .1) throw new Error(`PDF image lost resize, crop, or alignment: ${matrix}`)
      const second = (await (await pdf.getPage(2)).getTextContent()).items.map(item => item.str).join(' ')
      if (!second.includes('Second page content') || !second.includes('Page 2 of 2')) throw new Error('Second page or footer missing')
    } finally { await task.destroy() }
  }, Array.from(bytes))

  await selectText('Project heading', 0, 7)
  await page.getByRole('combobox', { name: 'Selected text font', exact: true }).selectOption('sans-serif')
  await page.getByRole('combobox', { name: 'Selected text size (pt)', exact: true }).selectOption('20')
  assert.equal(await editor.locator('h1 [data-text-size="20"]').innerText(), 'Project')
  await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
  await page.evaluate(async () => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer()) })
    try {
      const pdf = await task.promise
      const content = await (await pdf.getPage(1)).getTextContent()
      const selected = content.items.find(item => item.str === 'Project')
      const rest = content.items.find(item => item.str.trim() === 'heading')
      if (!selected || Math.abs(selected.transform[0] - 20) > .1 || !rest || Math.abs(rest.transform[0] - 28) > .1 || selected.fontName === rest.fontName) throw new Error('Partial heading font change affected surrounding text')
    } finally { await task.destroy() }
  })

  await page.getByRole('button', { name: 'Next preview page' }).click()
  await page.getByRole('img', { name: 'PDF preview page 2 of 2', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '2')
  if (process.env.CREATE_PDF_SCREENSHOT) await page.screenshot({ path: process.env.CREATE_PDF_SCREENSHOT, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => parseFloat(document.querySelector('.pdf-preview-viewport canvas').style.width) < 390)
  await editor.locator('img').click()
  await page.getByRole('button', { name: 'Crop image', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Apply crop', exact: true }).isDisabled(), true, 'An empty crop should not create a new image')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Editor overflows on mobile')
  if (process.env.CREATE_PDF_SCREENSHOT) await page.screenshot({ path: process.env.CREATE_PDF_SCREENSHOT.replace(/\.png$/, '-mobile-crop.png'), fullPage: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(apiCalls, [], 'New documents must remain local')
  console.log('Create PDF checks passed: selected fonts/sizes in paragraphs, partial headings and table cells, font undo/redo, document defaults, image editing, block movement, links, page breaks, matching PDF preview/download, mobile layout and local conversion.')
} finally {
  await browser?.close()
  server.kill()
}
