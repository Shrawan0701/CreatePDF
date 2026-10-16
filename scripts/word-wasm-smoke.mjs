// Synthetic integration fixture only; never reads or writes personal documents.
import { Document, Header, ImageRun, Packer, PageBreak, Paragraph, TextRun } from 'docx'
import { PDFDocument } from 'pdf-lib'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createWordPdfHandler } from '../server/wordPdf.js'

const image = new ImageRun({ type: 'png', data: await readFile(new URL('../src/assets/createpdf.png', import.meta.url)), transformation: { width: 40, height: 40 }, floating: { horizontalPosition: { relative: 'page', offset: 914400 }, verticalPosition: { relative: 'page', offset: 914400 } } })
const children = Array.from({ length: 16 }, (_, i) => new Paragraph({ children: [...(i ? [new PageBreak()] : [image]), new TextRun(`PAGE ${i + 1} - conversion regression content`)] }))
const bytes = await Packer.toBuffer(new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph('REPEATED HEADER')] }) }, children }] }))
const request = Readable.from([bytes])
request.method = 'POST'
request.headers = {}
const response = { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(body) { this.body = body } }
// Exercise the actual Vercel selection branch, regardless of the local OS.
await createWordPdfHandler({ env: { VERCEL: '1' } })(request, response)
assert.equal(response.statusCode, 200, String(response.body))
const pdf = await PDFDocument.load(response.body)
assert.equal(pdf.getPageCount(), 16)
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const loading = getDocument({ data: new Uint8Array(response.body), useSystemFonts: true })
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
