// Synthetic integration fixture only; never reads or writes personal documents.
import { Document, Header, ImageRun, Packer, PageBreak, Paragraph, TextRun } from 'docx'
import { PDFDocument } from 'pdf-lib'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createWordPdfHandler } from '../server/wordPdf.js'
import { exportWasmPdf } from '../server/wordWasm.js'
import { wordToPdf } from '../src/services/wordImport.js'

const image = new ImageRun({ type: 'png', data: await readFile(new URL('../src/assets/createpdf.png', import.meta.url)), transformation: { width: 40, height: 40 }, floating: { horizontalPosition: { relative: 'page', offset: 914400 }, verticalPosition: { relative: 'page', offset: 914400 } } })
const children = Array.from({ length: 16 }, (_, i) => new Paragraph({ children: [...(i ? [new PageBreak()] : [image]), new TextRun(`PAGE ${i + 1} - conversion regression content`)] }))
const bytes = await Packer.toBuffer(new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph('REPEATED HEADER')] }) }, children }] }))
// Exercise the actual Vercel selection branch, regardless of the local OS.
const server = createServer(createWordPdfHandler({ env: { VERCEL: '1' } }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const fetchOriginal = globalThis.fetch
globalThis.fetch = (url, options) => fetchOriginal(new URL(url, `http://127.0.0.1:${server.address().port}`), options)
let output
try {
  for (let i = 0; i < 2; i++) {
    const stages = []
    const start = performance.now()
    output = await wordToPdf(new Blob([bytes]), (value, label) => { stages.push({ value, label }); if (value === null) console.log(label) })
    assert.ok(stages.some(stage => stage.label === 'Converting document'))
    assert.deepEqual(stages.at(-1), { value: 100, label: 'PDF ready' })
    assert.equal(stages.some(stage => stage.label === 'Starting conversion engine'), i === 0)
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 16)
    console.log(`${i ? 'Warm' : 'Cold'} conversion: ${Math.round(performance.now() - start)} ms`)
  }
} finally {
  globalThis.fetch = fetchOriginal
  await new Promise(resolve => server.close(resolve))
  await exportWasmPdf.destroy()
}
const pdf = await PDFDocument.load(await output.arrayBuffer())
assert.equal(pdf.getPageCount(), 16)
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const loading = getDocument({ data: new Uint8Array(await output.arrayBuffer()), useSystemFonts: true })
const parsed = await loading.promise
try {
  for (let i = 1; i <= 16; i++) {
    const page = await parsed.getPage(i)
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ')
    assert.ok(text.includes(`PAGE ${i} -`), `Missing body on page ${i}`)
    assert.ok(text.includes('REPEATED HEADER'), `Missing header on page ${i}`)
  }
  // Inspect embedded objects, rather than accepting only a page-count match.
  assert.ok([...pdf.context.enumerateIndirectObjects()].some(([, object]) => object.dict?.toString().includes('/Subtype /Image')), 'Floating image was lost')
  console.log('PASS: deployed handler, 16 nonblank pages, repeated headers, floating image; no native Office executable.')
} finally { await loading.destroy() }
