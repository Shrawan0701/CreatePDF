import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { imagesToPdf, mergePdfs, parsePageRanges, rotatePdfPages, splitPdfByRanges } from './pdfEngine'

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

describe('image PDF page sizing', () => {
  const landscape = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEUUPFpEGPdjAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'
  const portrait = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAFAQMAAABVfa/fAAAAA1BMVEUUPFpEGPdjAAAAC0lEQVR4nGNggAEAAAoAAX+AdF4AAAAASUVORK5CYII='
  const image = encoded => new Blob([Buffer.from(encoded, 'base64')], { type: 'image/png' })

  it('defaults to a separate borderless page matching each image, preserving order and aspect ratio', async () => {
    const output = await imagesToPdf([image(landscape), image(portrait)])
    const pdf = await PDFDocument.load(await output.arrayBuffer())
    expect(pdf.getPages().map(page => [page.getWidth(), page.getHeight()])).toEqual([[4, 2], [2, 5]])
  })

  it('ignores paper margins in fit-to-image mode', async () => {
    const output = await imagesToPdf([image(landscape)], { pageSize: 'image', margin: 100 })
    const pdf = await PDFDocument.load(await output.arrayBuffer())
    expect(pdf.getPage(0).getSize()).toEqual({ width: 4, height: 2 })
  })

  it('retains explicitly selected paper sizes', async () => {
    const output = await imagesToPdf([image(landscape)], { pageSize: [612, 792], margin: 20 })
    const pdf = await PDFDocument.load(await output.arrayBuffer())
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  })
})
