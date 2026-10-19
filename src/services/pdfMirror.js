import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream } from 'pdf-lib'

const name = value => PDFName.of(value)
const check = signal => { if (signal?.aborted) throw new DOMException('Mirroring cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const numbers = value => {
  if (!(value instanceof PDFArray)) return null
  const entries = value.asArray().map(item => value.context.lookup(item))
  return entries.every(item => item instanceof PDFNumber && Number.isFinite(item.asNumber())) ? entries.map(item => item.asNumber()) : null
}
const point = (matrix, x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
const bounds = (matrix, rectangle) => {
  const [x1, y1, x2, y2] = rectangle
  const corners = [point(matrix, x1, y1), point(matrix, x2, y1), point(matrix, x1, y2), point(matrix, x2, y2)]
  return [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))]
}
const matrixCode = matrix => matrix.map(value => PDFNumber.of(value).toString()).join(' ')

// Axes follow the page as displayed. For a sideways page, reflecting the
// displayed x axis reflects the original PDF y axis, and vice versa. Centers
// use the visible crop/media intersection, including nonzero box origins.
export function mirrorPageMatrix(page, horizontal, vertical) {
  const media = page.getMediaBox(), crop = page.getCropBox()
  const left = Math.max(media.x, crop.x), bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width), top = Math.min(media.y + media.height, crop.y + crop.height)
  if (![left, bottom, right, top].every(Number.isFinite) || right <= left || top <= bottom) throw new Error('This page has an invalid visible area.')
  const rotation = (page.getRotation().angle % 360 + 360) % 360
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Page rotation must be a multiple of 90 degrees.')
  const sideways = rotation === 90 || rotation === 270
  const flipX = sideways ? vertical : horizontal, flipY = sideways ? horizontal : vertical
  return [flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? left + right : 0, flipY ? bottom + top : 0]
}

function transformPairs(dict, key, matrix, context) {
  const values = numbers(dict.lookup(name(key)))
  if (!values?.length || values.length % 2) return
  const result = []
  for (let index = 0; index < values.length; index += 2) result.push(...point(matrix, values[index], values[index + 1]))
  dict.set(name(key), context.obj(result))
}

function mirrorAppearance(value, matrix, context, cache) {
  const object = context.lookup(value)
  if (object instanceof PDFDict) {
    // Checkbox/radio appearance dictionaries contain a stream per state.
    const states = object.clone(context)
    for (const [key, appearance] of object.entries()) states.set(key, mirrorAppearance(appearance, matrix, context, cache))
    return states
  }
  if (!(object instanceof PDFStream)) return value
  const key = `${matrix[0]},${matrix[3]}`
  let variants = cache.get(object)
  if (!variants) { variants = new Map(); cache.set(object, variants) }
  if (variants.has(key)) return variants.get(key)
  const box = numbers(object.dict.lookup(name('BBox')))
  const ownMatrix = numbers(object.dict.lookup(name('Matrix'))) || [1, 0, 0, 1, 0, 0]
  if (box?.length !== 4 || ownMatrix.length !== 6) return value
  const extent = bounds(ownMatrix, box)
  if (extent[2] <= extent[0] || extent[3] <= extent[1]) return value
  // Wrap the original appearance (and its own Matrix) as a Form XObject.
  // Reflect in its transformed bounds so the viewer's Rect fitting remains
  // correct, even for rotated appearances. Keep fields editable and preserve
  // on/off states rather than flattening widgets into page images.
  const original = object.clone(context)
  original.dict.set(name('Type'), name('XObject')); original.dict.set(name('Subtype'), name('Form'))
  const originalRef = context.register(original)
  const reflection = [matrix[0], 0, 0, matrix[3], matrix[0] < 0 ? extent[0] + extent[2] : 0, matrix[3] < 0 ? extent[1] + extent[3] : 0]
  const wrapper = context.flateStream(`q\n${matrixCode(reflection)} cm\n/Original Do\nQ\n`, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: extent,
    Resources: { XObject: { Original: originalRef } },
  })
  const ref = context.register(wrapper)
  variants.set(key, ref)
  return ref
}

export function transformPdfAnnotation(annotation, matrix, context, appearances = new Map()) {
  const rectangle = numbers(annotation.lookup(name('Rect')))
  if (rectangle?.length === 4) annotation.set(name('Rect'), context.obj(bounds(matrix, rectangle)))
  for (const key of ['QuadPoints', 'Vertices', 'L', 'CL']) transformPairs(annotation, key, matrix, context)
  const ink = annotation.lookup(name('InkList'))
  if (ink instanceof PDFArray) {
    const transformed = []
    for (const stroke of ink.asArray()) {
      const values = numbers(context.lookup(stroke)), pairs = []
      if (!values || values.length % 2) { transformed.push(stroke); continue }
      for (let index = 0; index < values.length; index += 2) pairs.push(...point(matrix, values[index], values[index + 1]))
      transformed.push(context.obj(pairs))
    }
    annotation.set(name('InkList'), context.obj(transformed))
  }
  const difference = numbers(annotation.lookup(name('RD')))
  if (difference?.length === 4) {
    const [left, top, right, bottom] = difference
    annotation.set(name('RD'), context.obj([(matrix[0] < 0 ? right : left) * Math.abs(matrix[0]), (matrix[3] < 0 ? bottom : top) * Math.abs(matrix[3]), (matrix[0] < 0 ? left : right) * Math.abs(matrix[0]), (matrix[3] < 0 ? top : bottom) * Math.abs(matrix[3])]))
  }
  const appearancesDict = annotation.lookup(name('AP'))
  if (appearancesDict instanceof PDFDict && (matrix[0] < 0 || matrix[3] < 0)) {
    const next = appearancesDict.clone(context)
    for (const key of ['N', 'R', 'D']) {
      const value = appearancesDict.get(name(key))
      if (value) next.set(name(key), mirrorAppearance(value, matrix, context, appearances))
    }
    annotation.set(name('AP'), next)
  }
}

function transformDestination(destination, matrix) {
  const type = destination.lookup(1)?.toString()
  const change = (index, axis) => {
    const value = destination.lookup(index)
    if (value instanceof PDFNumber && Number.isFinite(value.asNumber())) destination.set(index, PDFNumber.of(matrix[axis === 'x' ? 0 : 3] * value.asNumber() + matrix[axis === 'x' ? 4 : 5]))
  }
  if (type === '/XYZ') { change(2, 'x'); change(3, 'y') }
  else if (type === '/FitH' || type === '/FitBH') change(2, 'y')
  else if (type === '/FitV' || type === '/FitBV') change(2, 'x')
  else if (type === '/FitR') {
    const values = [2, 3, 4, 5].map(index => destination.lookup(index))
    if (values.every(value => value instanceof PDFNumber && Number.isFinite(value.asNumber()))) bounds(matrix, values.map(value => value.asNumber())).forEach((value, index) => destination.set(index + 2, PDFNumber.of(value)))
  }
}

export async function transformPdfDestinations(document, matrices, signal) {
  // Named destinations, link actions and outline entries may share the same
  // explicit destination array. Walk reachable objects and change each once.
  const seen = new Set(), pending = [document.catalog]
  let visited = 0
  while (pending.length) {
    check(signal)
    const value = document.context.lookup(pending.pop())
    if (!value || seen.has(value)) continue
    seen.add(value)
    if (value instanceof PDFArray) {
      const target = value.get(0), matrix = target instanceof PDFRef && matrices.get(target.toString())
      if (matrix && value.size() > 1) transformDestination(value, matrix)
      for (const item of value.asArray()) pending.push(item)
    } else if (value instanceof PDFStream) pending.push(value.dict)
    else if (value instanceof PDFDict) { for (const item of value.values()) pending.push(item) }
    if (++visited % 300 === 0) await tick()
  }
}

export async function mirrorPdf(bytes, edits, { signal, onProgress = () => {} } = {}) {
  check(signal)
  const document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false })
  check(signal)
  const pages = document.getPages(), matrices = new Map(), appearances = new Map(), annotationsSeen = new Set()
  if (edits.length !== pages.length || edits.some((edit, index) => edit.num !== index + 1)) throw new Error('The page selection does not match this PDF.')
  for (const [index, edit] of edits.entries()) {
    check(signal)
    if (edit.flipX || edit.flipY) {
      const page = pages[index], matrix = mirrorPageMatrix(page, !!edit.flipX, !!edit.flipY)
      matrices.set(page.ref.toString(), matrix)
      const context = document.context, contents = page.node.Contents()
      const streams = contents instanceof PDFArray ? contents.asArray() : contents instanceof PDFStream ? [page.node.get(name('Contents'))] : []
      const before = context.register(context.flateStream(`q\n${matrixCode(matrix)} cm\n`))
      const after = context.register(context.flateStream('\nQ\n'))
      // A fresh array avoids changing other pages that share a Contents array.
      page.node.set(name('Contents'), context.obj([before, ...streams, after]))
      const annotations = page.node.Annots()
      for (let item = 0; annotations && item < annotations.size(); item++) {
        const annotation = annotations.lookup(item)
        if (annotation instanceof PDFDict && !annotationsSeen.has(annotation)) {
          annotationsSeen.add(annotation); transformPdfAnnotation(annotation, matrix, context, appearances)
          const popup = annotation.lookup(name('Popup'))
          if (popup instanceof PDFDict && !annotationsSeen.has(popup)) { annotationsSeen.add(popup); transformPdfAnnotation(popup, matrix, context, appearances) }
        }
      }
    }
    onProgress(Math.round((index + 1) / pages.length * 75))
    if (index % 10 === 0) await tick()
  }
  await transformPdfDestinations(document, matrices, signal)
  onProgress(85)
  const output = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 })
  check(signal); onProgress(100)
  return new Blob([output], { type: 'application/pdf' })
}
