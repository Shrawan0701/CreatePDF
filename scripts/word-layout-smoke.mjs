import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, Tab, TextRun } from 'docx'

const port = process.env.WORD_LAYOUT_PORT || '4186'
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' })
const directory = await mkdtemp(join(tmpdir(), 'createpdf-word-layout-'))
let browser
const errors = []
const sectionProperties = { page: { size: { width: 12240, height: 15840 }, margin: { top: 500, right: 720, bottom: 280, left: 600 } } }
const makeDoc = (children) => Packer.toBuffer(new Document({
  styles: { default: { document: { run: { font: 'Cambria', size: 20 }, paragraph: { spacing: { after: 0 } } } } },
  sections: [{ properties: sectionProperties, children }],
}))
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/health`)).ok) break } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, serviceWorkers: 'block' })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().startsWith('Word capture:')) console.log(message.text()) })
  // Render the finished PDF in the browser: an invisible search layer and an
  // image operator can both exist even when the actual page image is blank.
  await page.route('**/__word-test/pdf.mjs', route => route.fulfill({ path: resolve('node_modules/pdfjs-dist/build/pdf.mjs'), contentType: 'text/javascript' }))
  await page.route('**/__word-test/pdf.worker.mjs', route => route.fulfill({ path: resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), contentType: 'text/javascript' }))
  const assertVisiblePages = async (pdf, label) => {
    const ink = await page.evaluate(async (encoded) => {
      const pdfjs = await import('/__word-test/pdf.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = '/__word-test/pdf.worker.mjs'
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const loadingTask = pdfjs.getDocument({ data: bytes })
      const document = await loadingTask.promise
      try {
        const counts = []
        for (let index = 1; index <= document.numPages; index++) {
          const sheet = await document.getPage(index)
          const viewport = sheet.getViewport({ scale: .75 })
          const canvas = window.document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d', { willReadFrequently: true })
          await sheet.render({ canvasContext: context, viewport }).promise
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
          let dark = 0
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3] > 128 && Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 200) dark++
          }
          counts.push(dark)
          canvas.width = canvas.height = 0
          sheet.cleanup()
        }
        return counts
      } finally { await loadingTask.destroy() }
    }, Buffer.from(await pdf.getData()).toString('base64'))
    ink.forEach((count, index) => assert.ok(count > 40, `${label}: page ${index + 1} is visually blank (${count} ink pixels)`))
    console.log(`${label}: visible content verified on all ${ink.length} pages.`)
  }
  const convert = async (name, buffer) => {
    await page.goto(`${origin}/word-to-pdf`)
    await page.locator('input[type=file]').setInputFiles({ name: `${name}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer })
    if (process.argv.slice(2).length) await page.evaluate(() => {
      let last = ''
      new MutationObserver(() => {
        const progress = document.querySelector('.progress-bar-fill')?.style.width
        if (progress && progress !== last) { last = progress; console.debug(`Word capture: ${progress}`) }
      }).observe(document.body, { attributes: true, childList: true, subtree: true })
    })
    const downloading = Promise.race([
      page.waitForEvent('download', { timeout: 180000 }),
      page.locator('.toast-error').waitFor({ state: 'visible', timeout: 180000 }).then(async () => {
        throw new Error(await page.locator('.toast-error .toast-message').innerText())
      }),
    ])
    await page.getByRole('button', { name: 'Convert and download' }).click()
    const download = await downloading
    const path = join(directory, `${name}.pdf`)
    await download.saveAs(path)
    assert.equal(await page.locator('iframe[title="Word document conversion"]').count(), 0, 'Conversion iframe must be cleaned up')
    return getDocument({ data: new Uint8Array(await readFile(path)) }).promise
  }
  if (!process.argv.slice(2).length) {
    const short = await makeDoc([
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Resume layout', size: 40 })] }),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' } }, children: [new TextRun({ text: 'Technical Skills', bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: 'Languages: ', bold: true }), new TextRun('Java, JavaScript')] }),
      new Paragraph({ tabStops: [{ type: 'right', position: 10500 }], children: [new TextRun({ text: 'Developer', bold: true }), new TextRun({ children: [new Tab(), 'Jan 2025 - Present'] })] }),
      new Paragraph({ bullet: { level: 0 }, children: [new TextRun('Built a production application.')] }),
      new Paragraph({ children: [new ExternalHyperlink({ link: 'https://example.com/portfolio', children: [new TextRun({ text: 'Portfolio', style: 'Hyperlink' })] })] }),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Project')] }), new TableCell({ children: [new Paragraph('Technology')] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph('RateMate')] }), new TableCell({ children: [new Paragraph('Spring Boot')] })] })] }),
    ])
    const pdf = await convert('resume-layout', short)
    assert.equal(pdf.numPages, 1, 'Compact resume should remain one page')
    const first = await pdf.getPage(1)
    assert.deepEqual(first.view, [0, 0, 612, 792], 'Letter size must be preserved')
    const content = await first.getTextContent()
    const text = content.items.map(item => item.str).join(' ')
    for (const label of ['Resume layout', 'Technical Skills', 'Java, JavaScript', 'Developer', 'Jan 2025 - Present', 'Portfolio', 'RateMate', 'Spring Boot']) assert.ok(text.includes(label), `Searchable text lost: ${label}`)
    const heading = content.items.find(item => item.str.includes('Resume layout'))
    assert.ok(heading.transform[4] > 150 && heading.transform[4] < 300, 'Centered title lost alignment')
    const job = content.items.find(item => item.str.includes('Developer'))
    const date = content.items.find(item => item.str.includes('Jan 2025'))
    assert.ok(date.transform[4] > job.transform[4] + 200, 'Right tab position was flattened')
    assert.ok((await first.getAnnotations()).some(annotation => annotation.url === 'https://example.com/portfolio'), 'Clickable link missing')
    await assertVisiblePages(pdf, 'Compact resume')
    console.log('Compact resume: fonts, alignment, tabs, table text, links, paper size, and cleanup passed.')

    const explicit = await convert('explicit-pages', await makeDoc([new Paragraph('Before manual break'), new Paragraph({ children: [new PageBreak(), new TextRun('After manual break')] })]))
    assert.equal(explicit.numPages, 2)
    assert.match((await (await explicit.getPage(2)).getTextContent()).items.map(item => item.str).join(' '), /After manual break/)
    await assertVisiblePages(explicit, 'Explicit page break')
    console.log('Explicit page break passed.')

    const markers = Array.from({ length: 100 }, (_, index) => `ROW_${String(index).padStart(3, '0')}`)
    const long = await convert('overflow-table', await makeDoc([
      new Paragraph('Long document'),
      new Table({ rows: markers.map(marker => new TableRow({ children: [new TableCell({ children: [new Paragraph(marker)] }), new TableCell({ children: [new Paragraph('A table row with original formatting and content.')] })] })) }),
      new Paragraph('FINAL_MARKER'),
    ]))
    assert.ok(long.numPages >= 2, 'Overflowing table must paginate')
    let longText = ''
    for (let index = 1; index <= long.numPages; index++) {
      const sheet = await long.getPage(index)
      const items = (await sheet.getTextContent()).items.filter(item => item.str.trim())
      for (const item of items) assert.ok(item.transform[5] > 5 && item.transform[5] < 792, 'Text fell outside paper')
      longText += items.map(item => item.str).join(' ') + ' '
    }
    for (const marker of [...markers, 'FINAL_MARKER']) assert.equal(longText.split(marker).length - 1, 1, `Lost or duplicated ${marker}`)
    await assertVisiblePages(long, 'Overflowing table')
    console.log(`Natural table overflow: ${long.numPages} pages, every row retained exactly once.`)

    const paragraphs = Array.from({ length: 30 }, (_, index) => new Paragraph({ children: [new TextRun(`PARA_${String(index).padStart(3, '0')} ` + 'This sentence checks paragraph wrapping across sheets. '.repeat(10))] }))
    const flowing = await convert('overflow-paragraphs', await makeDoc(paragraphs))
    assert.ok(flowing.numPages > 1)
    let flowingText = ''
    for (let index = 1; index <= flowing.numPages; index++) flowingText += (await (await flowing.getPage(index)).getTextContent()).items.map(item => item.str).join(' ') + ' '
    for (let index = 0; index < 30; index++) assert.equal(flowingText.split(`PARA_${String(index).padStart(3, '0')}`).length - 1, 1)
    assert.equal((flowingText.match(/This sentence checks paragraph wrapping across sheets\./g) || []).length, 300)
    await assertVisiblePages(flowing, 'Overflowing paragraphs')
    console.log(`Natural paragraph overflow: ${flowing.numPages} pages, all sentences retained.`)
    const manyPages = []
    for (let index = 1; index <= 16; index++) {
      if (index > 1) manyPages.push(new Paragraph({ children: [new PageBreak()] }))
      manyPages.push(new Paragraph(`VISIBLE_PAGE_${String(index).padStart(2, '0')}`))
      for (let row = 0; row < 12; row++) manyPages.push(new Paragraph(`Page ${index}, line ${row + 1}: visible multi-page Word conversion regression.`))
    }
    const sixteen = await convert('sixteen-pages', await makeDoc(manyPages))
    assert.equal(sixteen.numPages, 16)
    for (let index = 1; index <= 16; index++) {
      const text = (await (await sixteen.getPage(index)).getTextContent()).items.map(item => item.str).join(' ')
      assert.ok(text.includes(`VISIBLE_PAGE_${String(index).padStart(2, '0')}`), `Wrong content on page ${index}`)
    }
    await assertVisiblePages(sixteen, 'Sixteen-page document')
  }
  for (const source of process.argv.slice(2)) {
    const name = basename(source, '.docx')
    const actual = await convert(name, await readFile(source))
    await assertVisiblePages(actual, name)
    const output = join(dirname(source), `${name}-fixed.pdf`)
    await writeFile(output, await actual.getData())
    console.log(`Corrected PDF: ${output}`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  server.kill()
  await rm(directory, { recursive: true, force: true })
}
