import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } from 'pdf-lib'
import { splitLoadedPdf } from './pdfSplit'
import { wordPageSelection } from './pdfWordLayout'

const name = value => PDFName.of(value)
const check = signal => { if (signal?.aborted) throw new DOMException('Splitting cancelled.', 'AbortError') }
export const halfSplitDefaults = () => ({ mode: 'pages', balanced: true, oddPage: 'first', splitAfter: '', position: 50, overlap: 0, pageRange: '', keepBookmarks: true })

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width), top = Math.min(a.y + a.height, b.y + b.height)
  return right > x && top > y ? { x, y, width: right - x, height: top - y } : null
}

export function halfPageGeometry(page, mode, position = 50, overlap = 0) {
  if (!['vertical', 'horizontal'].includes(mode)) throw new Error('Choose a page-cut direction.')
  const fraction = Number(position) / 100, overlapMM = Number(overlap)
  if (!Number.isFinite(fraction) || fraction < .1 || fraction > .9) throw new Error('Choose a cut position between 10% and 90%.')
  if (!Number.isFinite(overlapMM) || overlapMM < 0 || overlapMM > 20) throw new Error('Overlap must be between 0 and 20 mm.')
  const media = page.getMediaBox(), crop = page.getCropBox(), box = intersect(media, crop) || media
  if (!(box.width > 0 && box.height > 0)) throw new Error('This page has no usable visible area.')
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Page rotation must be a multiple of 90 degrees.')
  const rawUnit = page.node.lookup(name('UserUnit')), unit = rawUnit instanceof PDFNumber ? rawUnit.asNumber() : 1
  if (!(unit > 0 && Number.isFinite(unit))) throw new Error('This page has an invalid scale.')
  const sideways = rotation === 90 || rotation === 270
  const displayWidth = (sideways ? box.height : box.width) * unit, displayHeight = (sideways ? box.width : box.height) * unit
  const axis = mode === 'vertical' ? displayWidth : displayHeight
  const overlapRatio = overlapMM * 72 / 25.4 / axis
  if (overlapRatio >= 2 * Math.min(fraction, 1 - fraction)) throw new Error('Overlap is too large for this page. Reduce the overlap or move the cut closer to the center.')
  // (u,v) are normalized coordinates of the displayed, rotated page, measured
  // from its top-left. Convert them back into the original PDF coordinate space.
  const point = (u, v) => {
    if (rotation === 90) return [box.x + v * box.width, box.y + u * box.height]
    if (rotation === 180) return [box.x + (1 - u) * box.width, box.y + v * box.height]
    if (rotation === 270) return [box.x + (1 - v) * box.width, box.y + (1 - u) * box.height]
    return [box.x + u * box.width, box.y + (1 - v) * box.height]
  }
  const rectangle = (from, to) => {
    const a = mode === 'vertical' ? point(from, 0) : point(0, from)
    const b = mode === 'vertical' ? point(to, 1) : point(1, to)
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }
  }
  return { boxes: [rectangle(0, fraction + overlapRatio / 2), rectangle(fraction - overlapRatio / 2, 1)], displayWidth, displayHeight, overlapRatio, rotation, unit }
}

export function buildHalfSplitPlan(source, options = halfSplitDefaults()) {
  if (!source?.pageCount) throw new Error('Choose a PDF first.')
  const count = source.pageCount, { mode = 'pages' } = options
  if (mode === 'pages') {
    if (count < 2) throw new Error('Document splitting needs at least two pages. Use a left/right or top/bottom cut for a single page.')
    if (!['first', 'second'].includes(options.oddPage || 'first')) throw new Error('Choose which half receives an extra page.')
    const splitAfter = options.balanced !== false ? (options.oddPage === 'second' ? Math.floor(count / 2) : Math.ceil(count / 2)) : Number(options.splitAfter)
    if (!Number.isInteger(splitAfter) || splitAfter < 1 || splitAfter >= count) throw new Error(`Split after a whole page number from 1 to ${count - 1}.`)
    const groups = [Array.from({ length: splitAfter }, (_, index) => index + 1), Array.from({ length: count - splitAfter }, (_, index) => splitAfter + index + 1)]
    return { mode, splitAfter, selectedPages: Array.from({ length: count }, (_, index) => index + 1), omittedPages: 0, cuts: new Map(), outputs: groups.map((pages, index) => ({ id: index ? 'second-half' : 'first-half', label: index ? 'Second half' : 'First half', pages, pageCount: pages.length })), groups }
  }
  if (!['vertical', 'horizontal'].includes(mode)) throw new Error('Choose a split layout.')
  const selectedPages = wordPageSelection(options.pageRange || '', count), cuts = new Map()
  for (const number of selectedPages) {
    try { cuts.set(number, halfPageGeometry(source.document.getPage(number - 1), mode, options.position ?? 50, options.overlap ?? 0)) }
    catch (error) { throw new Error(`Page ${number}: ${error.message}`) }
  }
  const sides = mode === 'vertical' ? ['Left half', 'Right half'] : ['Top half', 'Bottom half']
  return { mode, cuts, selectedPages, omittedPages: count - selectedPages.length, outputs: sides.map(label => ({ id: label.toLowerCase().replace(' ', '-'), label, pages: [...selectedPages], pageCount: selectedPages.length })), groups: [[...selectedPages], [...selectedPages]] }
}

function readRectangle(array) {
  if (!(array instanceof PDFArray) || array.size() !== 4) return null
  const values = array.asArray().map(value => array.context.lookup(value))
  if (values.some(value => !(value instanceof PDFNumber) || !Number.isFinite(value.asNumber()))) return null
  const [x1, y1, x2, y2] = values.map(value => value.asNumber())
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

function destinationFits(destination, box) {
  const type = destination.lookup(1)?.toString()
  const number = index => { const value = destination.lookup(index); return value instanceof PDFNumber ? value.asNumber() : null }
  const insideX = value => value === null || value >= box.x - .001 && value <= box.x + box.width + .001
  const insideY = value => value === null || value >= box.y - .001 && value <= box.y + box.height + .001
  if (type === '/XYZ') return insideX(number(2)) && insideY(number(3))
  if (['/FitH', '/FitBH'].includes(type)) return insideY(number(2))
  if (['/FitV', '/FitBV'].includes(type)) return insideX(number(2))
  if (type === '/FitR') {
    const [left, bottom, right, top] = [2, 3, 4, 5].map(number)
    if ([left, bottom, right, top].some(value => value === null)) return false
    const clipped = intersect({ x: Math.min(left, right), y: Math.min(bottom, top), width: Math.abs(right - left), height: Math.abs(top - bottom) }, box)
    if (!clipped) return false
    for (const [index, value] of [[2, clipped.x], [3, clipped.y], [4, clipped.x + clipped.width], [5, clipped.y + clipped.height]]) destination.set(index, PDFNumber.of(value))
  }
  return true
}

function cropHalfPage({ page, pageNumber, outputIndex, output, copies }, plan, statistics) {
  const box = plan.cuts.get(pageNumber).boxes[outputIndex]
  page.setMediaBox(box.x, box.y, box.width, box.height); page.setCropBox(box.x, box.y, box.width, box.height)
  page.setTrimBox(box.x, box.y, box.width, box.height); page.setBleedBox(box.x, box.y, box.width, box.height); page.setArtBox(box.x, box.y, box.width, box.height)
  const annotations = page.node.Annots()
  const byRef = statistics[outputIndex].byRef || (statistics[outputIndex].byRef = new Map([...copies].map(([number, copied]) => [copied.ref.toString(), number])))
  for (let index = (annotations?.size() || 0) - 1; index >= 0; index--) {
    const annotation = annotations.lookup(index)
    if (!(annotation instanceof PDFDict)) continue
    const rectangle = readRectangle(annotation.lookup(name('Rect')))
    const visible = rectangle && intersect(rectangle, box)
    if (rectangle && !visible) { annotations.remove(index); continue }
    const subtype = annotation.lookup(name('Subtype'))?.toString()
    if (visible && subtype === '/Link') {
      annotation.set(name('Rect'), output.context.obj([visible.x, visible.y, visible.x + visible.width, visible.y + visible.height]))
      annotation.delete(name('QuadPoints'))
      const action = annotation.lookup(name('A')), direct = annotation.lookup(name('Dest'))
      const actionTarget = action instanceof PDFDict && action.lookup(name('S')) === name('GoTo') ? action.lookup(name('D')) : null
      const destination = direct instanceof PDFArray ? direct : actionTarget instanceof PDFArray ? actionTarget : null
      const target = destination?.get(0), targetNumber = target instanceof PDFRef ? byRef.get(target.toString()) : null
      if (targetNumber && !destinationFits(destination, plan.cuts.get(targetNumber).boxes[outputIndex])) {
        annotations.remove(index); statistics[outputIndex].outsideLinks++; continue
      }
    }
    // Widgets retain their original appearance rectangle. The page clips their
    // visible portion; resizing /Rect would stretch a partially cut form field.
  }
}

export async function createHalfPdfs(source, options = halfSplitDefaults(), { signal, onProgress = () => {} } = {}) {
  check(signal)
  const plan = buildHalfSplitPlan(source, options), statistics = [{ outsideLinks: 0 }, { outsideLinks: 0 }]
  const results = await splitLoadedPdf(source, plan.groups, { signal, onProgress, bookmarks: options.keepBookmarks ? source.bookmarks || [] : null,
    transformPage: plan.mode === 'pages' ? null : data => cropHalfPage(data, plan, statistics),
  })
  check(signal)
  return { plan, outputs: results.map((result, index) => ({ ...result, ...plan.outputs[index], outsideLinks: statistics[index].outsideLinks })) }
}

export function halfOutputName(prefix, output) {
  const base = String(prefix || '').trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 120).replace(/[. ]+$/, '') || 'document'
  return `${base}-${output.id}.pdf`
}
