import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, degrees } from 'pdf-lib'
import { loadPdfBytes } from './pdfEngine'
import { wordPageSelection } from './pdfWordLayout'

export const mixDefaults = () => ({ start: 0, leftovers: 'append', sources: [0, 1].map(() => ({ pageRange: '', reverse: false, rotation: 0, pagesPerTurn: 1 })) })
const check = signal => { if (signal?.aborted) throw new DOMException('Mixing cancelled.', 'AbortError') }

export async function readMixSource(file, signal) {
  check(signal)
  if (!file || (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf')) throw new Error('Choose a PDF file.')
  const bytes = await loadPdfBytes(file)
  check(signal)
  let document
  try { document = await PDFDocument.load(bytes, { updateMetadata: false }) }
  catch (error) {
    if (error.name === 'EncryptedPDFError' || /encrypted/i.test(error.message || '')) throw new Error('This PDF is password-protected. Save an unlocked copy with Remove Password, then add it here.')
    throw new Error('Could not read this PDF. Choose a valid PDF document.')
  }
  check(signal)
  if (!document.getPageCount()) throw new Error('This PDF has no pages to mix.')
  return { file, document, pageCount: document.getPageCount() }
}

export function buildMixPlan(counts, options = mixDefaults()) {
  if (counts.length !== 2 || counts.some(count => !Number.isInteger(count) || count < 1)) throw new Error('Choose two PDFs with at least one page each.')
  const settings = counts.map((_, index) => ({ ...mixDefaults().sources[index], ...options.sources?.[index] }))
  const start = Number(options.start ?? 0)
  if (![0, 1].includes(start)) throw new Error('Choose which PDF starts the mix.')
  const leftovers = options.leftovers || 'append'
  if (!['append', 'blank'].includes(leftovers)) throw new Error('Choose how to handle remaining pages.')
  const selections = counts.map((count, index) => {
    const setting = settings[index]
    const step = Number(setting.pagesPerTurn)
    if (!Number.isInteger(step) || step < 1 || step > 20) throw new Error(`PDF ${index ? 'B' : 'A'}: pages per turn must be between 1 and 20.`)
    if (![0, 90, 180, 270].includes(Number(setting.rotation))) throw new Error(`PDF ${index ? 'B' : 'A'}: choose a rotation of 0, 90, 180, or 270 degrees.`)
    let pages
    try { pages = wordPageSelection(setting.pageRange || '', count) } catch (error) { throw new Error(`PDF ${index ? 'B' : 'A'}: ${error.message}`) }
    return setting.reverse ? pages.reverse() : pages
  })
  const rounds = Math.max(...selections.map((pages, index) => Math.ceil(pages.length / Number(settings[index].pagesPerTurn))))
  const pages = []
  for (let round = 0; round < rounds; round++) {
    const chunks = selections.map((selected, index) => {
      const step = Number(settings[index].pagesPerTurn)
      return selected.slice(round * step, (round + 1) * step)
    })
    for (const source of [start, 1 - start]) {
      const count = leftovers === 'blank' ? Number(settings[source].pagesPerTurn) : chunks[source].length
      for (let offset = 0; offset < count; offset++) {
        if (offset < chunks[source].length) pages.push({ source, pageNumber: chunks[source][offset], rotation: Number(settings[source].rotation) })
        else {
          const other = 1 - source
          const referenceSource = chunks[other].length ? other : source
          const referencePage = chunks[referenceSource][Math.min(offset, chunks[referenceSource].length - 1)] || selections[referenceSource].at(-1)
          pages.push({ source: null, blankFor: source, reference: { source: referenceSource, pageNumber: referencePage } })
        }
      }
    }
  }
  return { pages, selections, blankPages: pages.filter(page => page.source === null).length, total: pages.length }
}

export function destinationArray(document, destination) {
  const value = document.context.lookup(destination)
  if (value instanceof PDFArray) return value
  if (value instanceof PDFDict) return value.lookupMaybe(PDFName.of('D'), PDFArray)
  const name = value instanceof PDFName ? value.decodeText() : value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null
  if (!name) return null
  const direct = document.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)?.get(PDFName.of(name))
  if (direct) return destinationArray(document, direct)
  const root = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.get(PDFName.of('Dests'))
  const visited = new Set()
  const find = reference => {
    const tree = document.context.lookup(reference)
    if (!(tree instanceof PDFDict) || visited.has(tree)) return null
    visited.add(tree)
    const names = tree.lookupMaybe(PDFName.of('Names'), PDFArray)
    for (let index = 0; names && index + 1 < names.size(); index += 2) {
      const key = document.context.lookup(names.get(index))
      if ((key instanceof PDFString || key instanceof PDFHexString) && key.decodeText() === name) return destinationArray(document, names.get(index + 1))
    }
    const kids = tree.lookupMaybe(PDFName.of('Kids'), PDFArray)
    for (let index = 0; kids && index < kids.size(); index++) { const result = find(kids.get(index)); if (result) return result }
    return null
  }
  return root ? find(root) : null
}

// Copying pages alone can leave links pointing at hidden copies of source pages.
// Resolve direct and named destinations against the pages actually added to the mix.
export function remapInternalLinks(source, copies, output) {
  let skipped = 0
  const pageByRef = new Map(source.getPages().map((page, index) => [page.ref.toString(), index + 1]))
  for (const [number, copied] of copies) {
    const originals = source.getPage(number - 1).node.Annots()
    const annotations = copied.node.Annots()
    for (let index = 0; originals && annotations && index < originals.size(); index++) {
      try {
        const original = originals.lookup(index, PDFDict), annotation = annotations.lookup(index, PDFDict)
        if (original.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue
        const action = original.lookupMaybe(PDFName.of('A'), PDFDict)
        const direct = original.get(PDFName.of('Dest'))
        if (!direct && action?.get(PDFName.of('S'))?.toString() !== '/GoTo') continue
        const destination = destinationArray(source, direct || action.get(PDFName.of('D')))
        const target = destination?.get(0)
        const targetNumber = target instanceof PDFRef ? pageByRef.get(target.toString()) : target instanceof PDFNumber ? target.asNumber() + 1 : null
        const targetPage = copies.get(targetNumber)
        if (!targetPage) {
          annotation.delete(PDFName.of('Dest')); annotation.delete(PDFName.of('A')); skipped++; continue
        }
        const mapped = output.context.obj([targetPage.ref, ...destination.asArray().slice(1).map(value => source.context.lookup(value))])
        if (direct) annotation.set(PDFName.of('Dest'), mapped)
        else annotation.lookup(PDFName.of('A'), PDFDict).set(PDFName.of('D'), mapped)
      } catch {
        // Retain a readable page when an individual annotation is malformed.
        skipped++
      }
    }
  }
  return skipped
}

export async function mixPdfDocuments(sources, options = mixDefaults(), progress = () => {}, signal) {
  check(signal)
  if (sources.length !== 2 || sources.some(source => !source?.document)) throw new Error('Choose two valid PDFs first.')
  const plan = buildMixPlan(sources.map(source => source.pageCount), options)
  const output = await PDFDocument.create()
  const copies = []
  for (const [index, source] of sources.entries()) {
    check(signal); progress(5 + index * 15, `Copying pages from PDF ${index ? 'B' : 'A'}`)
    const pages = await output.copyPages(source.document, plan.selections[index].map(number => number - 1))
    copies[index] = new Map(pages.map((page, pageIndex) => {
      page.setRotation(degrees((page.getRotation().angle + Number(options.sources?.[index]?.rotation || 0)) % 360))
      return [plan.selections[index][pageIndex], page]
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  for (const [index, item] of plan.pages.entries()) {
    check(signal)
    if (item.source !== null) output.addPage(copies[item.source].get(item.pageNumber))
    else {
      const reference = copies[item.reference.source].get(item.reference.pageNumber)
      const page = output.addPage([reference.getWidth(), reference.getHeight()])
      const media = reference.getMediaBox(), crop = reference.getCropBox()
      page.setMediaBox(media.x, media.y, media.width, media.height)
      page.setCropBox(crop.x, crop.y, crop.width, crop.height)
      page.setRotation(reference.getRotation())
    }
    if (index % 40 === 0 || index === plan.pages.length - 1) {
      progress(35 + Math.round((index + 1) / plan.total * 55), `Arranging page ${index + 1} of ${plan.total}`)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  check(signal)
  const skipped = sources.reduce((total, source, index) => total + remapInternalLinks(source.document, copies[index], output), 0)
  output.setTitle('Alternated PDF'); output.setCreator('CreatePDF.tech')
  progress(95, 'Saving your mixed PDF')
  const bytes = await output.save()
  check(signal); progress(100, 'Mixed PDF ready')
  return { blob: new Blob([bytes], { type: 'application/pdf' }), plan, warnings: skipped ? [`${skipped} internal page ${skipped === 1 ? 'link could' : 'links could'} not be carried over. Destinations outside the selected pages are not included.`] : [] }
}
