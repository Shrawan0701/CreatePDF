import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mergePdfs, parsePageRanges, rotatePdfPages, splitPdfByRanges } from './pdfEngine'

async function pdfFile(pageCount, name = 'fixture.pdf') {
  const document = await PDFDocument.create()
  for (let index = 0; index < pageCount; index++) document.addPage([300 + index, 400 + index])
  const blob = new Blob([await document.save()], { type: 'application/pdf' })
  Object.defineProperty(blob, 'name', { value: name })
  return blob
}

async function blobPageCount(blob) {
  return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount()
}

describe('parsePageRanges', () => {
  it('normalizes, deduplicates, sorts, and clamps ranges', () => {
    expect(parsePageRanges('5, 2-4, 3, 0-2, 99', 6)).toEqual([1, 2, 3, 4, 5])
  })

  it('ignores malformed and descending ranges', () => {
    expect(parsePageRanges('abc, 5-2, , 2', 5)).toEqual([2])
  })
})

describe('PDF page operations', () => {
  it('merges every source page in order', async () => {
    const output = await mergePdfs([await pdfFile(2, 'a.pdf'), await pdfFile(3, 'b.pdf')])
    expect(await blobPageCount(output)).toBe(5)
  })

  it('splits requested page groups', async () => {
    const outputs = await splitPdfByRanges(await pdfFile(4), [[1, 3], [2, 4]])
    expect(await Promise.all(outputs.map(blobPageCount))).toEqual([2, 2])
  })

  it('applies page rotations without dropping pages', async () => {
    const output = await rotatePdfPages(await pdfFile(2), { 0: 90, 1: 180 })
    const document = await PDFDocument.load(await output.arrayBuffer())
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([90, 180])
  })
})
