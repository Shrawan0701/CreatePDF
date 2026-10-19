import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from 'pdf-lib'
import { wordPageSelection } from './pdfWordLayout'
import { transformPdfAnnotation, transformPdfDestinations } from './pdfMirror'

const name = value => PDFName.of(value)
const mm = value => value * 72 / 25.4
const check = signal => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
export const CROP_PAPERS = { A4: [mm(210), mm(297)], A3: [mm(297), mm(420)], Letter: [612, 792], Legal: [612, 1008] }
export const cropResizeDefaults = () => ({ mode: 'crop', left: 0, top: 0, right: 0, bottom: 0, range: '', paper: 'A4', orientation: 'auto', width: 210, height: 297, margin: 5, fit: 'contain' })
const arrayNumbers = array => {
  if (!(array instanceof PDFArray)) return null
  const items = array.asArray().map(item => array.context.lookup(item))
  return items.every(item => item instanceof PDFNumber && Number.isFinite(item.asNumber())) ? items.map(item => item.asNumber()) : null
}
const rect = box => [box.x, box.y, box.x + box.width, box.y + box.height]
const intersect = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), top = Math.min(a.y + a.height, b.y + b.height)
  return right > x && top > y ? { x, y, width: right - x, height: top - y } : null
}

export function cropPageGeometry(page) {
  const box = intersect(page.getMediaBox(), page.getCropBox())
  const rotation = (page.getRotation().angle % 360 + 360) % 360
  const rawUnit = page.node.lookup(name('UserUnit')), unit = rawUnit instanceof PDFNumber ? rawUnit.asNumber() : 1
  if (!box || !rect(box).every(Number.isFinite) || ![0, 90, 180, 270].includes(rotation) || !Number.isFinite(unit) || unit <= 0) throw new Error('Unsupported page dimensions or rotation.')
  const sideways = rotation % 180 !== 0
  const width = (sideways ? box.height : box.width) * unit, height = (sideways ? box.width : box.height) * unit
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Unsupported page scale.')
  return { box, rotation, unit, width, height }
}

export function buildCropResizePlan(source, options) {
  if (!source?.pageCount) throw new Error('Choose a PDF first.')
  if (!['crop', 'resize', 'both'].includes(options.mode)) throw new Error('Choose crop, resize or both.')
  const cropping = options.mode !== 'resize', resizing = options.mode !== 'crop'
  const insets = Object.fromEntries(['left', 'top', 'right', 'bottom'].map(side => [side, cropping ? Number(options[side]) / 100 : 0]))
  if (cropping && Object.keys(insets).some(side => String(options[side]).trim() === '' || !Number.isFinite(insets[side]) || insets[side] < 0 || insets[side] > .98)) throw new Error('Crop margins must be between 0% and 98%.')
  if (insets.left + insets.right > .980000001 || insets.top + insets.bottom > .980000001) throw new Error('Keep at least 2% of the page width and height.')
  const selected = new Set(wordPageSelection(options.range || '', source.pageCount))
  const margin = mm(Number(options.margin))
  let paper = null
  if (resizing) {
    if (!['auto', 'portrait', 'landscape'].includes(options.orientation) || !['contain', 'cover'].includes(options.fit)) throw new Error('Choose an orientation and content fit.')
    if (String(options.margin).trim() === '' || !Number.isFinite(margin) || margin < 0 || margin > mm(100)) throw new Error('Use a margin from 0 to 100 mm.')
    paper = options.paper === 'custom' ? [mm(Number(options.width)), mm(Number(options.height))] : CROP_PAPERS[options.paper]
    if (!paper || paper.some(value => !Number.isFinite(value) || value < mm(10) || value > mm(2000))) throw new Error('Use a supported paper size or custom dimensions from 10 to 2,000 mm.')
  }
  const pages = source.document.getPages().map((page, index) => {
    const number = index + 1
    let original
    try { original = cropPageGeometry(page) } catch (failure) { throw new Error(`Page ${number}: ${failure.message}`) }
    const included = selected.has(number), edges = included ? insets : { left: 0, top: 0, right: 0, bottom: 0 }
    const { box, rotation, unit } = original
    const point = (u, v) => rotation === 90 ? [box.x + v * box.width, box.y + u * box.height] : rotation === 180 ? [box.x + (1 - u) * box.width, box.y + v * box.height] : rotation === 270 ? [box.x + (1 - v) * box.width, box.y + (1 - u) * box.height] : [box.x + u * box.width, box.y + (1 - v) * box.height]
    const a = point(edges.left, edges.top), b = point(1 - edges.right, 1 - edges.bottom)
    const cropped = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }
    const cropWidth = original.width * (1 - edges.left - edges.right), cropHeight = original.height * (1 - edges.top - edges.bottom)
    const changed = included && (resizing || Object.values(edges).some(value => value > 0))
    if (!resizing || !included) return { number, included, original, insets: edges, cropped, changed, resize: false, width: cropWidth, height: cropHeight, content: { x: 0, y: 0, width: cropWidth, height: cropHeight, scale: 1 }, margin: 0 }
    const landscape = options.orientation === 'landscape' || options.orientation === 'auto' && cropWidth > cropHeight
    const [width, height] = options.paper === 'custom' ? paper : landscape ? [paper[1], paper[0]] : paper
    if (width <= 2 * margin + 1 || height <= 2 * margin + 1) throw new Error('The page margin leaves no room for content. Reduce it or choose a larger paper size.')
    const scale = Math[options.fit === 'cover' ? 'max' : 'min']((width - 2 * margin) / cropWidth, (height - 2 * margin) / cropHeight)
    const sideways = rotation % 180 !== 0, rawWidth = (sideways ? height : width) / unit, rawHeight = (sideways ? width : height) / unit
    const x = (rawWidth - cropped.width * scale) / 2, y = (rawHeight - cropped.height * scale) / 2
    const matrix = [scale, 0, 0, scale, x - cropped.x * scale, y - cropped.y * scale]
    const fitted = { x, y, width: cropped.width * scale, height: cropped.height * scale }
    const inner = { x: margin / unit, y: margin / unit, width: rawWidth - 2 * margin / unit, height: rawHeight - 2 * margin / unit }
    return { number, included, changed, original, insets: edges, cropped, resize: true, width, height, rawWidth, rawHeight, matrix, inner, annotationClip: intersect(fitted, inner), margin, content: { x: (width - cropWidth * scale) / 2, y: (height - cropHeight * scale) / 2, width: cropWidth * scale, height: cropHeight * scale, scale } }
  })
  return { pages, changedCount: pages.filter(page => page.changed).length, selectedCount: selected.size, cropping, resizing }
}

function clipAppearance(value, fullRect, clipped, context, seen = new Set()) {
  const object = context.lookup(value)
  if (object instanceof PDFDict) {
    if (seen.has(object)) return value
    seen.add(object)
    const states = object.clone(context)
    for (const [key, state] of object.entries()) states.set(key, clipAppearance(state, fullRect, clipped, context, seen))
    return states
  }
  if (!(object instanceof PDFStream)) return value
  const box = arrayNumbers(object.dict.lookup(name('BBox'))), matrix = arrayNumbers(object.dict.lookup(name('Matrix'))) || [1, 0, 0, 1, 0, 0]
  if (box?.length !== 4 || matrix.length !== 6) return value
  const corners = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]])
  const left = Math.min(...corners.map(p => p[0])), bottom = Math.min(...corners.map(p => p[1])), width = Math.max(...corners.map(p => p[0])) - left, height = Math.max(...corners.map(p => p[1])) - bottom
  if (width <= 0 || height <= 0) return value
  const sx = fullRect.width / width, sy = fullRect.height / height
  const placement = [sx, 0, 0, sy, fullRect.x - sx * left, fullRect.y - sy * bottom].map(number => PDFNumber.of(number).toString()).join(' ')
  const form = object.clone(context)
  form.dict.set(name('Type'), name('XObject')); form.dict.set(name('Subtype'), name('Form'))
  return context.register(context.flateStream(`q\n${placement} cm\n/Original Do\nQ\n`, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect(clipped), Resources: { XObject: { Original: context.register(form) } } }))
}

function transformAnnotation(annotation, placement, context) {
  transformPdfAnnotation(annotation, placement.matrix, context)
  const rectangle = arrayNumbers(annotation.lookup(name('Rect')))
  if (rectangle?.length !== 4) return
  const full = { x: Math.min(rectangle[0], rectangle[2]), y: Math.min(rectangle[1], rectangle[3]), width: Math.abs(rectangle[2] - rectangle[0]), height: Math.abs(rectangle[3] - rectangle[1]) }
  const clipped = placement.annotationClip && intersect(full, placement.annotationClip)
  if (!clipped) {
    const flags = annotation.lookup(name('F'))
    annotation.set(name('F'), PDFNumber.of((flags instanceof PDFNumber ? flags.asNumber() : 0) | 2))
    return
  }
  if (rect(full).every((value, index) => Math.abs(value - rect(clipped)[index]) < .00001)) return
  const appearances = annotation.lookup(name('AP'))
  if (appearances instanceof PDFDict) {
    const next = appearances.clone(context)
    for (const key of ['N', 'R', 'D']) { const value = appearances.get(name(key)); if (value) next.set(name(key), clipAppearance(value, full, clipped, context)) }
    annotation.set(name('AP'), next)
  }
  annotation.set(name('Rect'), context.obj(rect(clipped)))
  if (annotation.lookup(name('Subtype')) === name('Link')) annotation.delete(name('QuadPoints'))
}

export async function createCropResizePdf(source, plan, { signal, onProgress = () => {} } = {}) {
  check(signal)
  if (!plan.changedCount) return { blob: source.file, unchanged: true }
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false, ignoreEncryption: false })
  const originals = document.getPages(), matrices = new Map(), seen = new Set()
  if (plan.pages.length !== originals.length) throw new Error('The source PDF changed. Add it again.')
  for (const placement of plan.pages) {
    check(signal)
    if (placement.changed) {
      const page = originals[placement.number - 1]
      if (placement.resize) {
        const context = document.context, current = page.node.Contents()
        const contents = current instanceof PDFArray ? current.asArray() : current instanceof PDFStream ? [page.node.get(name('Contents'))] : []
        const code = values => values.map(value => PDFNumber.of(value).toString()).join(' ')
        const inner = placement.inner, crop = placement.cropped
        const before = context.register(context.flateStream(`q\n${code([inner.x, inner.y, inner.width, inner.height])} re W n\n${code(placement.matrix)} cm\n${code([crop.x, crop.y, crop.width, crop.height])} re W n\n`))
        const after = context.register(context.flateStream('\nQ\n'))
        page.node.set(name('Contents'), context.obj([before, ...contents, after]))
        matrices.set(page.ref.toString(), placement.matrix)
        const annotations = page.node.Annots()
        for (let index = 0; annotations && index < annotations.size(); index++) {
          const annotation = annotations.lookup(index)
          if (annotation instanceof PDFDict && !seen.has(annotation)) {
            seen.add(annotation); transformAnnotation(annotation, placement, context)
            const popup = annotation.lookup(name('Popup'))
            if (popup instanceof PDFDict && !seen.has(popup)) { seen.add(popup); transformAnnotation(popup, placement, context) }
          }
        }
      }
      const box = placement.resize ? { x: 0, y: 0, width: placement.rawWidth, height: placement.rawHeight } : placement.cropped
      for (const method of ['setMediaBox', 'setCropBox', 'setBleedBox', 'setTrimBox', 'setArtBox']) page[method](box.x, box.y, box.width, box.height)
    }
    onProgress(Math.round(placement.number / plan.pages.length * 80), `Updating page ${placement.number} of ${plan.pages.length}`)
    if (placement.number % 10 === 0) await tick()
  }
  if (matrices.size) await transformPdfDestinations(document, matrices, signal)
  onProgress(90, 'Saving PDF')
  const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 })
  check(signal); onProgress(100, 'PDF ready')
  return { blob: new Blob([bytes], { type: 'application/pdf' }), unchanged: false }
}
