import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib'
import { wordPageSelection } from './pdfWordLayout'
import { destinationArray } from './alternateMix'

const mm = value => value * 72 / 25.4
const name = value => PDFName.of(value)
const check = signal => { if (signal?.aborted) throw new DOMException('Creation cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
export const NUP_COUNTS = [2, 4, 6, 9, 16]
export const NUP_PAPERS = { A4: [mm(210), mm(297)], A3: [mm(297), mm(420)], Letter: [612, 792], Legal: [612, 1008] }
export const nupDefaults = () => ({ count: 4, paper: 'A4', orientation: 'auto', range: '', margin: 8, gap: 4, order: 'across', autoRotate: true, borders: false })
const point = (matrix, x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
const bounds = (matrix, rect) => {
  const points = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]].map(([x, y]) => point(matrix, x, y))
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
}
const values = array => {
  if (!(array instanceof PDFArray)) return null
  const items = array.asArray().map(item => array.context.lookup(item))
  return items.every(item => item instanceof PDFNumber && Number.isFinite(item.asNumber())) ? items.map(item => item.asNumber()) : null
}

function geometry(page) {
  const media = page.getMediaBox(), crop = page.getCropBox()
  const left = Math.max(media.x, crop.x), bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width), top = Math.min(media.y + media.height, crop.y + crop.height)
  const rotation = (page.getRotation().angle % 360 + 360) % 360
  if (![left, bottom, right, top].every(Number.isFinite) || right <= left || top <= bottom || ![0, 90, 180, 270].includes(rotation)) throw new Error('A source page has an unsupported rotation or visible area.')
  return { left, bottom, right, top, width: right - left, height: top - bottom, rotation }
}

function fit(box, width, height, autoRotate) {
  const swapped = box.rotation % 180 !== 0, nativeWidth = swapped ? box.height : box.width, nativeHeight = swapped ? box.width : box.height
  const normal = Math.min(width / nativeWidth, height / nativeHeight), turned = Math.min(width / nativeHeight, height / nativeWidth)
  const extraRotation = autoRotate && turned > normal + .000001 ? 90 : 0
  return { scale: extraRotation ? turned : normal, extraRotation, width: (extraRotation ? nativeHeight : nativeWidth) * (extraRotation ? turned : normal), height: (extraRotation ? nativeWidth : nativeHeight) * (extraRotation ? turned : normal) }
}

export function buildNupPlan(source, options = nupDefaults()) {
  if (!source?.document || !source.pageCount) throw new Error('Choose a PDF first.')
  const count = Number(options.count), paper = NUP_PAPERS[options.paper], marginMM = Number(options.margin), gapMM = Number(options.gap)
  if (!NUP_COUNTS.includes(count) || !paper) throw new Error('Choose a supported layout and paper size.')
  if (!['auto', 'portrait', 'landscape'].includes(options.orientation) || !['across', 'down'].includes(options.order)) throw new Error('Choose an orientation and page order.')
  if (String(options.margin).trim() === '' || String(options.gap).trim() === '' || !Number.isFinite(marginMM) || !Number.isFinite(gapMM) || marginMM < 0 || marginMM > 40 || gapMM < 0 || gapMM > 30) throw new Error('Use margins from 0–40 mm and spacing from 0–30 mm.')
  const numbers = wordPageSelection(options.range || '', source.pageCount), originals = source.document.getPages()
  const boxes = numbers.map(number => { try { return geometry(originals[number - 1]) } catch (failure) { throw new Error(`Page ${number}: ${failure.message}`) } })
  const grids = count === 2 ? [[2, 1], [1, 2]] : count === 6 ? [[3, 2], [2, 3]] : [[Math.sqrt(count), Math.sqrt(count)]]
  const orientations = options.orientation === 'auto' ? count === 2 || count === 6 ? ['landscape', 'portrait'] : ['portrait', 'landscape'] : [options.orientation]
  const margin = mm(marginMM), gap = mm(gapMM)
  let best = null
  for (const orientation of orientations) for (const [columns, rows] of grids) {
    const [width, height] = orientation === 'landscape' ? [paper[1], paper[0]] : paper
    const cellWidth = (width - 2 * margin - (columns - 1) * gap) / columns, cellHeight = (height - 2 * margin - (rows - 1) * gap) / rows
    if (cellWidth <= 1 || cellHeight <= 1) continue
    const score = boxes.slice(0, 32).reduce((sum, box) => { const placed = fit(box, cellWidth, cellHeight, options.autoRotate); return sum + placed.width * placed.height }, 0)
    if (!best || score > best.score + .001) best = { width, height, columns, rows, cellWidth, cellHeight, orientation, score }
  }
  if (!best) throw new Error('Margins and spacing leave no room for pages. Reduce them or choose larger paper.')
  const sheets = Array.from({ length: Math.ceil(numbers.length / count) }, () => [])
  const placements = numbers.map((number, index) => {
    const box = boxes[index], slot = index % count, sheet = Math.floor(index / count)
    const column = options.order === 'down' ? Math.floor(slot / best.rows) : slot % best.columns
    const row = options.order === 'down' ? slot % best.rows : Math.floor(slot / best.columns)
    const fitted = fit(box, best.cellWidth, best.cellHeight, options.autoRotate)
    const x = margin + column * (best.cellWidth + gap) + (best.cellWidth - fitted.width) / 2
    const y = best.height - margin - (row + 1) * best.cellHeight - row * gap + (best.cellHeight - fitted.height) / 2
    const rotation = (box.rotation + fitted.extraRotation) % 360
    const native = rotation === 90 ? [0, -1, 1, 0, -box.bottom, box.right] : rotation === 180 ? [-1, 0, 0, -1, box.right, box.top] : rotation === 270 ? [0, 1, -1, 0, box.top, -box.left] : [1, 0, 0, 1, -box.left, -box.bottom]
    const matrix = native.map((value, position) => value * fitted.scale + (position === 4 ? x : position === 5 ? y : 0))
    const placed = { number, sheet, slot, box, ...fitted, x, y, rotation, matrix }
    sheets[sheet].push(placed); return placed
  })
  const hasForms = numbers.some(number => {
    const annotations = originals[number - 1].node.Annots()
    for (let index = 0; annotations && index < annotations.size(); index++) {
      const annotation = annotations.lookup(index)
      if (annotation instanceof PDFDict && annotation.lookup(name('Subtype')) === name('Widget')) return true
    }
    return false
  })
  return { ...best, margin, gap, count, numbers, placements, sheets, pageCount: numbers.length, sheetCount: sheets.length, emptySlots: sheets.length * count - numbers.length, borders: !!options.borders, paper: options.paper, hasForms }
}

function stampAppearance(page, annotation, source) {
  const flags = annotation.lookup(name('F'))
  if (flags instanceof PDFNumber && flags.asNumber() & (1 | 2 | 32)) return true
  const rectangle = values(annotation.lookup(name('Rect'))), appearances = annotation.lookup(name('AP'))
  if (rectangle?.length !== 4) return false
  let appearance = appearances instanceof PDFDict ? appearances.lookup(name('N')) : null
  if (appearance instanceof PDFDict) {
    const state = annotation.lookup(name('AS'))
    appearance = state instanceof PDFName ? appearance.lookup(state) : appearance.lookup(name('Off'))
  }
  if (!(appearance instanceof PDFStream)) return false
  const box = values(appearance.dict.lookup(name('BBox'))), matrix = values(appearance.dict.lookup(name('Matrix'))) || [1, 0, 0, 1, 0, 0]
  if (box?.length !== 4 || matrix.length !== 6) return false
  const extent = bounds(matrix, box), rect = [Math.min(rectangle[0], rectangle[2]), Math.min(rectangle[1], rectangle[3]), Math.max(rectangle[0], rectangle[2]), Math.max(rectangle[1], rectangle[3])]
  if (extent[2] <= extent[0] || extent[3] <= extent[1] || rect[2] <= rect[0] || rect[3] <= rect[1]) return false
  const sx = (rect[2] - rect[0]) / (extent[2] - extent[0]), sy = (rect[3] - rect[1]) / (extent[3] - extent[1])
  const form = appearance.clone(source.context)
  form.dict.set(name('Type'), name('XObject')); form.dict.set(name('Subtype'), name('Form'))
  const key = page.node.newXObject('Annotation', source.context.register(form))
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rect[0] - sx * extent[0], rect[1] - sy * extent[1]), drawObject(key), popGraphicsState())
  return true
}

export async function createNupPdf(source, plan, { signal, onProgress = () => {} } = {}) {
  check(signal)
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false, ignoreEncryption: false })
  const originalPages = document.getPages(), output = await PDFDocument.create(), links = [], selectedPages = [], boxes = []
  let missingAppearances = 0, skippedLinks = 0
  const byRef = new Map(originalPages.map((page, index) => [page.ref.toString(), index + 1]))
  // Build appearances for fields that do not yet have one, where the source
  // fonts permit it. Existing appearance streams remain the preferred source.
  try { const form = document.getForm(); if (form.getFields().length) form.updateFieldAppearances() } catch { /* Missing appearances are counted below. */ }
  for (const [index, placement] of plan.placements.entries()) {
    check(signal)
    const page = originalPages[placement.number - 1]
    page.pushOperators(pushGraphicsState(), popGraphicsState()) // Also supports truly blank pages.
    const annotations = page.node.Annots()
    for (let item = 0; annotations && item < annotations.size(); item++) {
      const annotation = annotations.lookup(item)
      if (!(annotation instanceof PDFDict)) continue
      if (annotation.lookup(name('Subtype')) === name('Link')) {
        if (annotation.lookup(name('AP')) && !stampAppearance(page, annotation, document)) missingAppearances++
        const rectangle = values(annotation.lookup(name('Rect'))), action = annotation.lookup(name('A'))
        if (rectangle?.length !== 4) { skippedLinks++; continue }
        const flags = annotation.lookup(name('F'))
        if (flags instanceof PDFNumber && flags.asNumber() & (1 | 2 | 32)) continue
        const uri = action instanceof PDFDict && action.lookup(name('S')) === name('URI') ? action.lookup(name('URI')) : null
        if (uri && typeof uri.decodeText === 'function') links.push({ placement, rectangle, uri })
        else {
          try {
            const direct = annotation.get(name('Dest')), goTo = action instanceof PDFDict && action.lookup(name('S')) === name('GoTo')
            const destination = direct || goTo ? destinationArray(document, direct || action.get(name('D'))) : null
            const target = destination?.get(0), number = target instanceof PDFRef ? byRef.get(target.toString()) : target instanceof PDFNumber ? target.asNumber() + 1 : null
            if (number) links.push({ placement, rectangle, target: number }); else skippedLinks++
          } catch { skippedLinks++ }
        }
      } else {
        const printed = stampAppearance(page, annotation, document)
        if (!printed && (annotation.lookup(name('Subtype')) === name('Widget') || annotation.lookup(name('AP')))) missingAppearances++
      }
    }
    // Logical annotations are recreated as sheet links; visible form/comment
    // appearances are now page content. Avoid copying hidden source pages via
    // annotation destinations or widget parent references during embedding.
    page.node.delete(name('Annots'))
    selectedPages.push(page); boxes.push(placement.box)
    onProgress(Math.round((index + 1) / plan.pageCount * 25), 'Preparing pages')
    if (index % 10 === 0) await tick()
  }
  const embedded = await output.embedPages(selectedPages, boxes, selectedPages.map(() => [1, 0, 0, 1, 0, 0]))
  const sheets = plan.sheets.map(() => output.addPage([plan.width, plan.height]))
  for (const [index, placement] of plan.placements.entries()) {
    check(signal)
    const page = sheets[placement.sheet], item = embedded[index]
    await item.embed()
    const key = page.node.newXObject('Page', item.ref)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...placement.matrix), drawObject(key), popGraphicsState())
    if (plan.borders) page.drawRectangle({ x: placement.x, y: placement.y, width: placement.width, height: placement.height, borderColor: rgb(.65, .67, .68), borderWidth: .4 })
    onProgress(25 + Math.round((index + 1) / plan.pageCount * 60), `Arranging sheet ${placement.sheet + 1} of ${plan.sheetCount}`)
    if (index % 8 === 0) await tick()
  }
  const byNumber = new Map(plan.placements.map(placement => [placement.number, placement]))
  for (const link of links) {
    check(signal)
    const { placement, rectangle } = link, box = placement.box
    const clipped = [Math.max(Math.min(rectangle[0], rectangle[2]), box.left), Math.max(Math.min(rectangle[1], rectangle[3]), box.bottom), Math.min(Math.max(rectangle[0], rectangle[2]), box.right), Math.min(Math.max(rectangle[1], rectangle[3]), box.top)]
    if (clipped[2] <= clipped[0] || clipped[3] <= clipped[1]) continue
    const annotation = output.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: bounds(placement.matrix, clipped), Border: [0, 0, 0], P: sheets[placement.sheet].ref })
    if (link.uri) annotation.set(name('A'), output.context.obj({ S: 'URI', URI: link.uri }))
    else {
      const target = byNumber.get(link.target)
      if (!target) { skippedLinks++; continue }
      annotation.set(name('Dest'), output.context.obj([sheets[target.sheet].ref, 'FitR', target.x, target.y, target.x + target.width, target.y + target.height]))
    }
    sheets[placement.sheet].node.addAnnot(output.context.register(annotation))
  }
  const title = document.getTitle()
  output.setTitle(title ? `${title} — ${plan.count} pages per sheet` : `${plan.count} pages per sheet`)
  output.setCreator('CreatePDF.tech')
  onProgress(92, 'Saving PDF')
  const bytes = await output.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 })
  check(signal); onProgress(100, 'PDF ready')
  return { blob: new Blob([bytes], { type: 'application/pdf' }), missingAppearances, skippedLinks }
}
