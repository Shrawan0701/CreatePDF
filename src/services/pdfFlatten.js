import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, BlendMode, concatTransformationMatrix, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, drawObject } from 'pdf-lib'
import { getPdfjsLib, loadPdfBytes } from './pdfEngine'
import { pdfDisplayGeometry, watermarkPageSelection } from './pdfWatermark'

const MARKUP = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Redact'])
const name = value => PDFName.of(value)
const check = signal => { if (signal?.aborted) throw new DOMException('Flattening cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
export const flattenDefaults = () => ({ forms: true, annotations: true, pagesMode: 'all', range: '', dpi: 200 })
const subtype = dict => dict.lookupMaybe(name('Subtype'), PDFName)?.decodeText() || ''
const flags = dict => dict.lookupMaybe(name('F'), PDFNumber)?.asNumber() || 0
const hidden = dict => !!(flags(dict) & (1 | 2 | 32))

function inherited(dict, key) {
  const seen = new Set()
  while (dict && !seen.has(dict)) {
    seen.add(dict)
    const value = dict.get(name(key))
    if (value) return dict.context.lookup(value)
    dict = dict.lookupMaybe(name('Parent'), PDFDict)
  }
}

function entriesOnPage(page) {
  const annots = page.node.Annots()
  return (annots?.asArray() || []).map(raw => ({ raw, dict: page.doc.context.lookup(raw) })).filter(entry => entry.dict instanceof PDFDict)
}

export function flattenPlan(source, options) {
  if (!options.forms && !options.annotations) throw new Error('Choose form fields, annotations, or both.')
  if (![150, 200, 300].includes(Number(options.dpi))) throw new Error('Choose a supported annotation quality.')
  const selection = watermarkPageSelection(options, source.pageCount), selected = new Set(selection)
  if (!selection.length) throw new Error('No pages match this selection.')
  const targets = source.inventory.filter(item => selected.has(item.page) && ((item.kind === 'form' && options.forms) || (item.kind === 'annotation' && options.annotations)))
  return { selection, targets, affected: [...new Set(targets.map(item => item.page))], forms: targets.filter(item => item.kind === 'form').length, annotations: targets.filter(item => item.kind === 'annotation').length }
}

export async function readFlattenSource(file, { signal, purpose = 'flattening it' } = {}) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.')
  const bytes = await loadPdfBytes(file); check(signal)
  let document
  try { document = await PDFDocument.load(bytes, { updateMetadata: false }) }
  catch (failure) { throw new Error(/encrypt|password/i.test(failure.message) ? `Unlock this PDF before ${purpose}.` : 'Could not open this PDF.') }
  const acroForm = document.catalog.lookupMaybe(name('AcroForm'), PDFDict)
  // Accessing pdf-lib's getForm() deletes XFA data, even without flattening.
  if (acroForm?.has(name('XFA'))) throw new Error('This PDF uses XFA forms. Save a standard PDF copy in a PDF reader first.')
  const pages = document.getPages(), inventory = [], fieldIds = new Set()
  if (!pages.length) throw new Error('This PDF has no pages.')
  let links = 0, other = 0, signatures = 0
  for (let index = 0; index < pages.length; index++) {
    check(signal); pdfDisplayGeometry(pages[index])
    for (const { dict } of entriesOnPage(pages[index])) {
      const type = subtype(dict)
      if (type === 'Link') { links++; continue }
      if (type === 'Widget') {
        const parent = dict.lookupMaybe(name('Parent'), PDFDict) || dict
        fieldIds.add(parent)
        if (inherited(dict, 'FT')?.toString() === '/Sig' && inherited(dict, 'V')) signatures++
        inventory.push({ page: index + 1, kind: 'form', type })
      } else if (MARKUP.has(type)) inventory.push({ page: index + 1, kind: 'annotation', type })
      else if (type !== 'Popup') other++
    }
    if (index % 12 === 0) await tick()
  }
  check(signal)
  return { file, bytes, pageCount: pages.length, inventory, fieldCount: fieldIds.size, links, other, signatures }
}

function normalAppearance(dict, context) {
  const ap = dict.lookupMaybe(name('AP'), PDFDict)
  let value = ap?.get(name('N')), stream = context.lookup(value)
  if (stream instanceof PDFDict) {
    const state = dict.lookupMaybe(name('AS'), PDFName) || inherited(dict, 'V')
    value = (state instanceof PDFName ? stream.get(state) : null) || stream.get(name('Off'))
    stream = context.lookup(value)
  }
  if (!(stream instanceof PDFStream)) return null
  const box = stream.dict.lookupMaybe(name('BBox'), PDFArray)?.asArray().map(value => context.lookup(value, PDFNumber).asNumber())
  const matrix = stream.dict.lookupMaybe(name('Matrix'), PDFArray)?.asArray().map(value => context.lookup(value, PDFNumber).asNumber()) || [1, 0, 0, 1, 0, 0]
  if (box?.length !== 4 || matrix.length !== 6 || ![...box, ...matrix].every(Number.isFinite)) return null
  const [a, b, c, d, e, f] = matrix
  const points = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const left = Math.min(...points.map(point => point[0])), bottom = Math.min(...points.map(point => point[1])), width = Math.max(...points.map(point => point[0])) - left, height = Math.max(...points.map(point => point[1])) - bottom
  if (!(width > 0 && height > 0)) return null
  return { ref: value instanceof PDFRef ? value : context.register(stream), left, bottom, width, height }
}

function annotationRect(dict) {
  const rect = dict.lookupMaybe(name('Rect'), PDFArray)?.asArray().map(value => dict.context.lookup(value, PDFNumber).asNumber())
  if (rect?.length !== 4 || !rect.every(Number.isFinite)) throw new Error('An annotation has an invalid rectangle.')
  return [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]
}

function drawAppearance(page, dict, appearance) {
  const [left, bottom, right, top] = annotationRect(dict), sx = (right - left) / appearance.width, sy = (top - bottom) / appearance.height
  if (!(sx > 0 && sy > 0)) return
  const key = page.node.newXObject('FlattenedAppearance', appearance.ref)
  page.pushOperators(pushGraphicsState(), rectangle(left, bottom, right - left, top - bottom), clip(), endPath(), concatTransformationMatrix(sx, 0, 0, sy, left - appearance.left * sx, bottom - appearance.bottom * sy), drawObject(key), popGraphicsState())
}

function pruneFormTree(document, removed) {
  const form = document.catalog.lookupMaybe(name('AcroForm'), PDFDict)
  if (!form) return
  const seen = new Set(), deletedFields = new Set()
  const prune = raw => {
    const dict = document.context.lookup(raw)
    if (!(dict instanceof PDFDict)) return raw
    if (removed.has(dict)) { deletedFields.add(dict); return null }
    if (seen.has(dict)) return raw
    seen.add(dict)
    const kids = dict.lookupMaybe(name('Kids'), PDFArray)
    if (kids?.size()) {
      const kept = kids.asArray().map(prune).filter(Boolean)
      if (!kept.length) { deletedFields.add(dict); return null }
      dict.set(name('Kids'), document.context.obj(kept))
    }
    return raw
  }
  const fields = form.lookupMaybe(name('Fields'), PDFArray)
  const kept = (fields?.asArray() || []).map(prune).filter(Boolean)
  if (!kept.length) { document.catalog.delete(name('AcroForm')); return }
  form.set(name('Fields'), document.context.obj(kept))
  const order = form.lookupMaybe(name('CO'), PDFArray)
  if (order) form.set(name('CO'), document.context.obj(order.asArray().filter(raw => !deletedFields.has(document.context.lookup(raw)))))
}

async function renderFallback(document, page, entry, renderer, options, signal) {
  const { pdf, pdfjs } = await renderer(), physical = page.doc.getPages().indexOf(page) + 1
  check(signal)
  const sourcePage = await pdf.getPage(physical), operatorList = await sourcePage.getOperatorList({ intent: 'display', annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE })
  check(signal)
  if (!(entry.raw instanceof PDFRef)) throw new Error('This annotation has no reusable appearance. Save a standard PDF copy and retry.')
  const id = `${entry.raw.objectNumber}R${entry.raw.generationNumber || ''}`, included = new Set()
  let active = false, found = false
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op = operatorList.fnArray[index]
    if (op === pdfjs.OPS.beginAnnotation) { active = operatorList.argsArray[index][0] === id; found ||= active }
    if (active || op === pdfjs.OPS.dependency) included.add(index)
    if (op === pdfjs.OPS.endAnnotation) active = false
  }
  if (!found) throw new Error('This annotation has no drawable appearance. Save a standard PDF copy in a PDF reader and retry.')
  const native = sourcePage.getViewport({ scale: 1 }), scale = Math.min(Number(options.dpi) / 72, 8192 / Math.max(native.width, native.height), Math.sqrt(16_000_000 / (native.width * native.height)))
  const viewport = sourcePage.getViewport({ scale }), canvas = window.document.createElement('canvas'), crop = window.document.createElement('canvas')
  let task
  const abort = () => task?.cancel()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    check(signal); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    task = sourcePage.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'rgba(0,0,0,0)', annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE, intent: 'display', operationsFilter: index => included.has(index) })
    await task.promise; check(signal)
    const rect = annotationRect(entry.dict), corners = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]].map(point => viewport.convertToViewportPoint(...point))
    const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0]))) - 2), top = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1]))) - 2)
    const right = Math.min(canvas.width, Math.ceil(Math.max(...corners.map(point => point[0]))) + 2), bottom = Math.min(canvas.height, Math.ceil(Math.max(...corners.map(point => point[1]))) + 2)
    if (right <= left || bottom <= top) return
    crop.width = right - left; crop.height = bottom - top; crop.getContext('2d').drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const blob = await new Promise((resolve, reject) => crop.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode this annotation.')), 'image/png'))
    check(signal)
    const image = await document.embedPng(await blob.arrayBuffer()), box = pdfDisplayGeometry(page)
    check(signal); page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...box.matrix), rectangle(0, 0, box.width, box.height), clip(), endPath())
    page.drawImage(image, { x: left / scale, y: box.height - bottom / scale, width: crop.width / scale, height: crop.height / scale, blendMode: subtype(entry.dict) === 'Highlight' ? BlendMode.Multiply : BlendMode.Normal })
    page.pushOperators(popGraphicsState())
  } finally { signal?.removeEventListener('abort', abort); canvas.width = canvas.height = crop.width = crop.height = 0 }
}

export async function createFlattenedPdf(source, options, { signal, onProgress } = {}) {
  const plan = flattenPlan(source, options); check(signal)
  if (!plan.targets.length) return { blob: source.file, forms: 0, annotations: 0, fallback: 0, pages: 0 }
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false }), pages = document.getPages(), removed = new Set(), selected = new Set(plan.selection)
  const needsAppearances = document.catalog.lookupMaybe(name('AcroForm'), PDFDict)?.lookupMaybe(name('NeedAppearances'), PDFBool)?.asBoolean()
  let loadingTask, rendererPromise, fallback = 0, forms = 0, annotations = 0
  const renderer = () => rendererPromise ||= (async () => {
    const pdfjs = await getPdfjsLib(); check(signal)
    loadingTask = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false, enableXfa: false })
    const pdf = await loadingTask.promise; check(signal); return { pdfjs, pdf }
  })()
  try {
    for (let index = 0; index < pages.length; index++) {
      check(signal)
      if (!selected.has(index + 1)) continue
      const page = pages[index], entries = entriesOnPage(page)
      page.node.normalize()
      for (const entry of entries) {
        const type = subtype(entry.dict), widget = type === 'Widget'
        if (!(widget ? options.forms : options.annotations && MARKUP.has(type))) continue
        check(signal); onProgress?.(index / pages.length * 90, `Flattening page ${index + 1} of ${pages.length}…`)
        if (!hidden(entry.dict)) {
          // Freeze fixed-size items at the page's native scale. A fixed-rotation
          // item on a rotated page needs a separate orientation-aware appearance.
          if ((flags(entry.dict) & 16) && page.getRotation().angle % 360) throw new Error(`Page ${index + 1}: an annotation has a fixed orientation on a rotated page. Save a standard PDF copy before flattening it.`)
          if (entry.dict.has(name('OC'))) throw new Error(`Page ${index + 1}: an annotation depends on an optional layer. Save a standard PDF copy before flattening it.`)
          const appearance = widget && needsAppearances ? null : normalAppearance(entry.dict, document.context)
          try { if (appearance) drawAppearance(page, entry.dict, appearance); else { await renderFallback(document, page, entry, renderer, options, signal); fallback++ } }
          catch (failure) { check(signal); throw new Error(`Page ${index + 1} (${widget ? 'form field' : type}): ${failure.message}`) }
        }
        removed.add(entry.dict); widget ? forms++ : annotations++
        await tick()
      }
    }
    for (const page of pages) {
      const kept = entriesOnPage(page).filter(({ dict }) => !removed.has(dict) && !(subtype(dict) === 'Popup' && removed.has(dict.lookupMaybe(name('Parent'), PDFDict))))
      if (page.node.Annots()) page.node.set(name('Annots'), document.context.obj(kept.map(entry => entry.raw)))
    }
    if (options.forms) pruneFormTree(document, removed)
    check(signal); onProgress?.(96, 'Finishing flattened PDF…'); await tick()
    const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 }); check(signal); onProgress?.(100, 'Flattened PDF ready')
    return { blob: new Blob([bytes], { type: 'application/pdf' }), forms, annotations, fallback, pages: plan.affected.length }
  } finally { await loadingTask?.destroy().catch(() => {}) }
}
