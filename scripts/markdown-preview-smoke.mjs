import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4193'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4193', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite is starting. */ }
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
    Blob.prototype.arrayBuffer = function () { if (this.type === 'application/pdf') globalThis.previewPdfBlob = this; return read.call(this) }
  })
  await page.goto(`${origin}/markdown-to-pdf`, { waitUntil: 'networkidle' })
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
  assert.ok((await editor.boundingBox()).height >= 380, 'Markdown editor is too short')
  const ready = async () => {
    await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
    await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
  }
  await editor.fill('')
  assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true)
  await page.getByRole('status').filter({ hasText: 'Add Markdown to preview' }).waitFor()
  await editor.fill('Selected words')
  await editor.selectText()
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  assert.equal(await editor.inputValue(), '**Selected words**')
  await page.getByRole('button', { name: 'Code block', exact: true }).click()
  assert.ok((await editor.inputValue()).includes('```\nSelected words\n```'))

  const markdown = [
    '# Release report', '', 'Normal words with **bold marker** and *italic marker* plus `inlineCode()`.', '',
    '[Project website](https://example.com/report)', '',
    '- Parent item', '  - Nested item', '', '3. Third item', '4. Fourth item', '',
    '- [x] Completed task', '- [ ] Pending task', '', '> A useful quoted note.', '',
    '| Product | Amount |', '| :--- | ---: |', '| Apple | 1250 |', '| Pear | **950** |', '',
    '```jsx', 'function Example() {', '  return <View title="Literal JSX" />;', '}', '```', '',
    '<script>window.markdownScriptRan = true</script>', '',
    ...Array.from({ length: 45 }, (_, index) => `Paragraph ${index + 1} keeps the document readable across multiple PDF pages.`),
    '', 'LAST_MARKDOWN_MARKER',
  ].join('\n')
  await page.getByLabel('Import Markdown or code file').setInputFiles({ name: 'release-report.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  assert.equal(await page.getByRole('textbox', { name: 'PDF filename', exact: true }).inputValue(), 'release-report')
  await page.getByRole('textbox', { name: 'Header', exact: true }).fill('Team release report')
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Page {page} of {total}')
  await ready()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const download = await pending
  assert.equal(download.suggestedFilename(), 'release-report.pdf')
  const bytes = await readFile(await download.path())
  const preview = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))
  assert.deepEqual(Buffer.from(preview), bytes, 'Downloaded PDF differs from preview')
  await page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise
      if (pdf.numPages < 2) throw new Error('Markdown document was not paginated')
      const first = await pdf.getPage(1)
      const content = await first.getTextContent()
      const text = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ')
      for (const value of ['Release report', 'Normal words', 'bold marker', 'italic marker', 'inlineCode()', 'Parent item', 'Nested item', '3.', 'Third item', '[x]', '[ ]', 'Completed task', 'Pending task', 'A useful quoted note.', 'Product', 'Apple', '1250', 'function Example()', '<View title="Literal JSX" />;', 'Team release report']) if (!text.includes(value)) throw new Error(`PDF lost ${value}: ${text}`)
      const fonts = ['Normal words', 'bold marker', 'italic marker', 'inlineCode()'].map(value => content.items.find(item => item.str.includes(value))?.fontName)
      if (fonts.some(font => !font) || new Set(fonts).size !== 4) throw new Error('Inline Markdown styles did not stay separate')
      const parent = content.items.find(item => item.str.includes('Parent item'))
      const nested = content.items.find(item => item.str.includes('Nested item'))
      if (nested.transform[4] <= parent.transform[4]) throw new Error('Nested list indentation was lost')
      const codeStart = content.items.find(item => item.str === 'function')
      const codeReturn = content.items.find(item => item.str.includes('return'))
      if (!codeStart || !codeReturn) throw new Error(`Code lines missing: ${JSON.stringify(content.items.map(item => item.str))}`)
      const leadingSpaces = codeReturn.str.match(/^ */)[0].length
      if (codeReturn.transform[4] + leadingSpaces * codeReturn.transform[0] * .6 <= codeStart.transform[4] + 5) throw new Error('Code indentation was lost')
      if (!(await first.getAnnotations()).some(annotation => annotation.url === 'https://example.com/report')) throw new Error('Markdown link is not clickable')
      const last = (await (await pdf.getPage(pdf.numPages)).getTextContent()).items.map(item => item.str).join(' ')
      if (!last.includes('LAST_MARKDOWN_MARKER') || !last.includes(`Page ${pdf.numPages} of ${pdf.numPages}`)) throw new Error('Last content or page tokens were lost')
    } finally { await task.destroy() }
  }, Array.from(bytes))
  assert.equal(await page.evaluate(() => globalThis.markdownScriptRan), undefined)
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '2')
  await page.getByRole('combobox', { name: 'Preview zoom', exact: true }).selectOption('1')
  await page.waitForFunction(() => parseFloat(document.querySelector('.pdf-preview-viewport canvas').style.width) === 595)
  await page.getByRole('combobox', { name: 'Preview zoom', exact: true }).selectOption('fit-page')
  if (process.env.MARKDOWN_SCREENSHOT) await page.screenshot({ path: process.env.MARKDOWN_SCREENSHOT, fullPage: true })

  const source = 'function greet(name) {\n  return <View title="SOURCE_LITERAL" />;\n}\n\n' + Array.from({ length: 100 }, (_, index) => `  // Code line ${index + 1}`).join('\n') + '\n' + 'LONG_LITERAL_'.repeat(70) + '\nEND_SOURCE_MARKER'
  await page.getByLabel('Import Markdown or code file').setInputFiles({ name: 'source.jsx', mimeType: 'text/plain', buffer: Buffer.from(source) })
  assert.equal(await page.getByRole('combobox', { name: 'Content format', exact: true }).inputValue(), 'code')
  assert.equal(await page.getByRole('textbox', { name: 'Text or source code', exact: true }).inputValue(), source)
  await page.getByRole('combobox', { name: 'Page size', exact: true }).selectOption('Letter')
  await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('landscape')
  await ready()
  await page.evaluate(async () => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer()) })
    try {
      const pdf = await task.promise
      const first = await pdf.getPage(1)
      if (first.view[2] !== 792 || first.view[3] !== 612 || pdf.numPages < 2) throw new Error('Source file page settings or pagination failed')
      let text = ''
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const content = await page.getTextContent()
        for (const item of content.items) {
          if (item.transform[4] < 45 || item.transform[4] + item.width > 747) throw new Error('A long code line was clipped horizontally')
        }
        text += content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ') + ' '
      }
      if (!text.includes('<View title="SOURCE_LITERAL" />;') || !text.includes('Code line 100') || !text.includes('END_SOURCE_MARKER')) throw new Error('Source file content was interpreted as HTML or lost')
    } finally { await task.destroy() }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => parseFloat(document.querySelector('.pdf-preview-viewport canvas').style.width) < 390)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Markdown editor overflows on mobile')
  assert.deepEqual(errors, [])
  assert.deepEqual(apiCalls, [], 'Markdown conversion must stay local')
  console.log('Markdown checks passed: actual PDF preview/download match, import and filenames, inline styles, nested lists, tasks, tables, links, literal JSX, code indentation/wrapping/pagination, headers/footers, zoom/navigation, mobile layout and local conversion.')
} finally {
  await browser?.close()
  server.kill()
}
