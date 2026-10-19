import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib'
import { buildMixPlan, mixDefaults, mixPdfDocuments, readMixSource } from './alternateMix'

async function source(count, base = 300) {
  const document = await PDFDocument.create()
  for (let number = 1; number <= count; number++) document.addPage([base + number, 500 + number])
  return { document, pageCount: count }
}
const labels = plan => plan.pages.map(page => page.source === null ? '-' : `${page.source ? 'B' : 'A'}${page.pageNumber}`)
const loadOutput = async result => PDFDocument.load(await result.blob.arrayBuffer())

describe('alternate mix ordering', () => {
  it('retains all pages when A is longer', () => {
    expect(labels(buildMixPlan([4, 2]))).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'A4'])
  })
  it('retains all pages when B is longer and can start with B', () => {
    expect(labels(buildMixPlan([1, 3], { ...mixDefaults(), start: 1 }))).toEqual(['B1', 'A1', 'B2', 'B3'])
  })
  it('selects and reverses the original page numbers before mixing', () => {
    const options = mixDefaults()
    options.sources[0].pageRange = '2, 4-5'
    options.sources[1] = { ...options.sources[1], pageRange: '1-3', reverse: true }
    expect(labels(buildMixPlan([6, 5], options))).toEqual(['A2', 'B3', 'A4', 'B2', 'A5', 'B1'])
  })
  it('supports different block sizes and incomplete final turns', () => {
    const options = mixDefaults(); options.sources[0].pagesPerTurn = 2
    expect(labels(buildMixPlan([5, 2], options))).toEqual(['A1', 'A2', 'B1', 'A3', 'A4', 'B2', 'A5'])
  })
  it('adds correctly positioned blanks to uneven scans', () => {
    const plan = buildMixPlan([3, 1], { ...mixDefaults(), leftovers: 'blank' })
    expect(labels(plan)).toEqual(['A1', 'B1', 'A2', '-', 'A3', '-'])
    expect(plan.blankPages).toBe(2)
    expect(plan.pages[3].reference).toEqual({ source: 0, pageNumber: 2 })
  })
  it('pads an incomplete block without dropping the other PDF', () => {
    const options = mixDefaults(); options.leftovers = 'blank'; options.sources[0].pagesPerTurn = 2
    expect(labels(buildMixPlan([3, 2], options))).toEqual(['A1', 'A2', 'B1', 'A3', '-', 'B2'])
  })
  it.each(['0', '4', '3-2', '1,', 'abc'])('rejects invalid page selection %s', range => {
    const options = mixDefaults(); options.sources[1].pageRange = range
    expect(() => buildMixPlan([3, 3], options)).toThrow('PDF B:')
  })
  it.each([0, -1, 1.5, 21, NaN])('rejects invalid block size %s', step => {
    const options = mixDefaults(); options.sources[0].pagesPerTurn = step
    expect(() => buildMixPlan([3, 3], options)).toThrow('pages per turn')
  })
  it('rejects invalid rotations and missing sources', () => {
    const options = mixDefaults(); options.sources[0].rotation = 45
    expect(() => buildMixPlan([3, 3], options)).toThrow('rotation')
    expect(() => buildMixPlan([0, 3])).toThrow('Choose two PDFs')
  })
})

describe('mixed PDF output', () => {
  it('copies every selected page in the planned order at its original size', async () => {
    const output = await loadOutput(await mixPdfDocuments([await source(3), await source(2, 400)]))
    expect(output.getPages().map(page => page.getWidth())).toEqual([301, 401, 302, 402, 303])
  })
  it('retains crop boxes and existing rotations and leaves source pages unchanged', async () => {
    const first = await source(2), second = await source(1, 400)
    first.document.getPage(0).setRotation(degrees(90)); first.document.getPage(0).setCropBox(10, 20, 250, 400)
    const options = mixDefaults(); options.sources[0].rotation = 180
    const output = await loadOutput(await mixPdfDocuments([first, second], options))
    expect(output.getPage(0).getRotation().angle).toBe(270)
    expect(output.getPage(0).getCropBox()).toEqual({ x: 10, y: 20, width: 250, height: 400 })
    expect(first.document.getPage(0).getRotation().angle).toBe(90)
    expect(first.document.getPage(1).getRotation().angle).toBe(0)
  })
  it('matches inserted blanks to the corresponding source page geometry', async () => {
    const a = await source(3), b = await source(1, 400)
    a.document.getPage(1).setRotation(degrees(90)); a.document.getPage(1).setCropBox(12, 18, 200, 300)
    const result = await mixPdfDocuments([a, b], { ...mixDefaults(), leftovers: 'blank' })
    const output = await loadOutput(result)
    expect(output.getPageCount()).toBe(6)
    expect(output.getPage(3).getSize()).toEqual(output.getPage(2).getSize())
    expect(output.getPage(3).getCropBox()).toEqual(output.getPage(2).getCropBox())
    expect(output.getPage(3).getRotation()).toEqual(output.getPage(2).getRotation())
  })
  it('maps direct and named internal links to the real mixed pages', async () => {
    const a = await source(3), b = await source(3, 400), document = a.document
    const destination = document.context.obj([document.getPage(2).ref, 'Fit'])
    const named = document.context.obj({ Names: [PDFString.of('last'), destination] })
    document.catalog.set(PDFName.of('Names'), document.context.obj({ Dests: named }))
    const links = [
      document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 40, 20], Dest: destination })),
      document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 30, 40, 50], A: { S: 'GoTo', D: PDFString.of('last') } })),
      document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 60, 40, 80], A: { S: 'URI', URI: PDFString.of('https://example.com/report') } })),
    ]
    document.getPage(0).node.set(PDFName.of('Annots'), document.context.obj(links))
    const options = mixDefaults(); options.sources[0].reverse = true
    const result = await mixPdfDocuments([a, b], options)
    expect(result.warnings).toEqual([])
    const output = await loadOutput(result)
    const annotations = output.getPage(4).node.Annots()
    expect(annotations.lookup(0, PDFDict).lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(output.getPage(0).ref.toString())
    expect(annotations.lookup(1, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('D'), PDFArray).get(0).toString()).toBe(output.getPage(0).ref.toString())
    expect(annotations.lookup(2, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.com/report')
    options.sources[0].pageRange = '1-2'
    const excluded = await mixPdfDocuments([a, b], options)
    expect(excluded.warnings[0]).toContain('2 internal page links')
  })
  it('cancels before reading or during mixing without returning an output', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(readMixSource(new Blob(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const running = new AbortController()
    await expect(mixPdfDocuments([await source(3), await source(3)], mixDefaults(), (_, label) => { if (label.startsWith('Arranging')) running.abort() }, running.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects non-PDF files and malformed documents with useful messages', async () => {
    const image = new Blob(['image'], { type: 'image/png' }); Object.defineProperty(image, 'name', { value: 'image.png' })
    await expect(readMixSource(image)).rejects.toThrow('Choose a PDF')
    const broken = new Blob(['broken'], { type: 'application/pdf' }); Object.defineProperty(broken, 'name', { value: 'broken.pdf' })
    await expect(readMixSource(broken)).rejects.toThrow('Could not read this PDF')
  })
})
