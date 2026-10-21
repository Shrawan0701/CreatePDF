import { PDFDocument, PDFName, BlendMode, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, setFillingRgbColor, setGraphicsState, fill } from 'pdf-lib'
import { getPdfjsLib } from './pdfEngine'
import { createFlattenedPdf, readFlattenSource } from './pdfFlatten'
import { pdfDisplayGeometry, watermarkPageSelection } from './pdfWatermark'

export const COLOUR_MODES = { dark: 'Dark', invert: 'Invert', sepia: 'Sepia', grayscale: 'Grayscale', light: 'Light', contrast: 'High contrast' }
export const colourDefaults = () => ({ mode: 'dark', method: 'preserve', paper: '#202328', ink: '#e5e7eb', threshold: 145, dpi: 200, encoding: 'jpeg', flatten: false, pagesMode: 'all', range: '' })
const check = signal => { if (signal?.aborted) throw new DOMException('Colour conversion cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const channels = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
export const readColourSource = (file, config = {}) => readFlattenSource(file, { ...config, purpose: 'changing its colours' })

export function validateColours(options, total) {
  if (!Object.hasOwn(COLOUR_MODES, options.mode)) throw new Error('Choose a colour preset.')
  if (!['preserve', 'image'].includes(options.method)) throw new Error('Choose an export method.')
  if (options.mode === 'contrast' && options.method !== 'image') throw new Error('High contrast requires image output.')
  if (options.mode === 'dark') {
    if (![options.paper, options.ink].every(value => /^#[0-9a-f]{6}$/i.test(value))) throw new Error('Choose valid paper and text colours.')
    if (channels(options.paper).some((value, index) => value >= channels(options.ink)[index])) throw new Error('Use a darker paper colour and a lighter text colour.')
  }
  if (options.mode === 'contrast' && (!Number.isFinite(Number(options.threshold)) || Number(options.threshold) < 32 || Number(options.threshold) > 224 || String(options.threshold).trim() === '')) throw new Error('Contrast threshold must be between 32 and 224.')
  if (![150, 200, 300].includes(Number(options.dpi)) || !['jpeg', 'png'].includes(options.encoding)) throw new Error('Choose a supported image quality and format.')
  const selection = watermarkPageSelection(options, total)
  if (!selection.length) throw new Error('No pages match this selection.')
  return selection
}

function frame(page, box, draw) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...box.matrix), rectangle(0, 0, box.width, box.height), clip(), endPath())
  draw(); page.pushOperators(popGraphicsState())
}

function whiteBackdrop(page, box) {
  page.node.normalize()
  // Use a separate stream: appending the inversion to the background stream
  // would run it before the document's original content.
  const operators = [pushGraphicsState(), concatTransformationMatrix(...box.matrix), setFillingRgbColor(1, 1, 1), rectangle(0, 0, box.width, box.height), fill(), popGraphicsState()]
  const ref = page.doc.context.register(page.doc.context.flateStream(operators.map(operator => operator.toString()).join('\n')))
  const old = page.node.Contents()?.asArray() || []
  page.node.set(PDFName.of('Contents'), page.doc.context.obj([ref, ...old]))
}

function recolourVector(page, box, options) {
  whiteBackdrop(page, box)
  frame(page, box, () => {
    const cover = (colour, blendMode) => {
      // pdf-lib's public BlendMode enum omits the PDF non-separable modes
      // Color and Saturation. Store their standard names directly in the PDF.
      const state = page.doc.context.register(page.doc.context.obj({ Type: 'ExtGState', BM: PDFName.of(blendMode) }))
      const key = page.node.newExtGState('PageColourBlend', state)
      page.pushOperators(pushGraphicsState(), setGraphicsState(key), setFillingRgbColor(...colour), rectangle(0, 0, box.width, box.height), fill(), popGraphicsState())
    }
    if (['dark', 'invert', 'light'].includes(options.mode)) {
      cover([1, 1, 1], BlendMode.Difference)
      if (options.mode === 'dark') { cover(channels(options.paper), BlendMode.Lighten); cover(channels(options.ink), BlendMode.Darken) }
    } else if (options.mode === 'sepia') { cover([.5, .32, .12], 'Color'); cover([.965, .925, .845], BlendMode.Multiply) }
    else if (options.mode === 'grayscale') cover([.5, .5, .5], 'Saturation')
  })
}

async function renderBody(pdf, pdfjs, number, dpi, signal, small = false) {
  check(signal)
  const page = await pdf.getPage(number), native = page.getViewport({ scale: 1 })
  const scale = small ? Math.min(.4, 360 / Math.max(native.width, native.height)) : Math.min(dpi / 72, 8192 / Math.max(native.width, native.height), Math.sqrt(16_000_000 / (native.width * native.height)))
  const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height))
  let task
  const abort = () => task?.cancel()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    check(signal)
    task = page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' })
    await task.promise; check(signal); return canvas
  } catch (failure) { canvas.width = canvas.height = 0; check(signal); throw failure }
  finally { signal?.removeEventListener('abort', abort) }
}

async function hasDarkPaper(pdf, pdfjs, number, signal) {
  const canvas = await renderBody(pdf, pdfjs, number, 72, signal, true)
  try {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), samples = []
    // Sample bands on all four edges; a logo in one corner cannot decide the mode.
    for (const inset of [.01, .03, .06]) for (let step = 0; step <= 20; step++) {
      const position = .05 + step / 20 * .9
      for (const [x, y] of [[position, inset], [position, 1 - inset], [inset, position], [1 - inset, position]]) {
        const index = (Math.min(canvas.height - 1, Math.floor(y * canvas.height)) * canvas.width + Math.min(canvas.width - 1, Math.floor(x * canvas.width))) * 4
        samples.push(data[index] * .3 + data[index + 1] * .59 + data[index + 2] * .11)
      }
    }
    samples.sort((a, b) => a - b)
    return samples[Math.floor(samples.length / 2)] < 112
  } finally { canvas.width = canvas.height = 0 }
}

function paintSepia(data, index, lum) {
  const offset = lum - (.3 * .5 + .59 * .32 + .11 * .12)
  let r = .5 + offset, g = .32 + offset, b = .12 + offset
  const minimum = Math.min(r, g, b)
  if (minimum < 0) { const scale = lum / (lum - minimum); r = lum + (r - lum) * scale; g = lum + (g - lum) * scale; b = lum + (b - lum) * scale }
  const maximum = Math.max(r, g, b)
  if (maximum > 1) { const scale = (1 - lum) / (maximum - lum); r = lum + (r - lum) * scale; g = lum + (g - lum) * scale; b = lum + (b - lum) * scale }
  data[index] = Math.round(r * .965 * 255); data[index + 1] = Math.round(g * .925 * 255); data[index + 2] = Math.round(b * .845 * 255)
}

async function recolourPixels(canvas, options, signal) {
  const context = canvas.getContext('2d'), image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data, paper = channels(options.paper), ink = channels(options.ink)
  const inverted = ['dark', 'invert', 'light'].includes(options.mode), threshold = Number(options.threshold)
  for (let row = 0; row < canvas.height; row++) {
    for (let index = row * canvas.width * 4, end = index + canvas.width * 4; index < end; index += 4) {
      const r = data[index] / 255, g = data[index + 1] / 255, b = data[index + 2] / 255, lum = .3 * r + .59 * g + .11 * b
      if (inverted) {
        for (let channel = 0; channel < 3; channel++) {
          const value = 1 - data[index + channel] / 255
          data[index + channel] = Math.round((options.mode === 'dark' ? Math.min(ink[channel], Math.max(paper[channel], value)) : value) * 255)
        }
      } else if (options.mode === 'sepia') paintSepia(data, index, lum)
      else { const value = options.mode === 'contrast' ? (lum * 255 >= threshold ? 255 : 0) : Math.round(lum * 255); data[index] = data[index + 1] = data[index + 2] = value }
      data[index + 3] = 255
    }
    if (row % 64 === 0) { check(signal); await tick() }
  }
  check(signal); context.putImageData(image, 0, 0)
}

export async function createColourPdf(source, options, { signal, onProgress } = {}) {
  const selection = validateColours(options, source.pageCount); check(signal)
  let bytes = source.bytes, flattened = 0
  if (options.flatten && source.inventory.length) {
    const result = await createFlattenedPdf(source, { forms: true, annotations: true, pagesMode: options.pagesMode, range: options.range, dpi: Number(options.dpi) }, { signal, onProgress: (value, label) => onProgress?.(value * .2, label) })
    bytes = new Uint8Array(await result.blob.arrayBuffer()); flattened = result.forms + result.annotations; check(signal)
  }
  const pdfDocument = await PDFDocument.load(bytes, { updateMetadata: false }); check(signal)
  let loadingTask, rendererPromise, changed = 0, skipped = 0
  const renderer = () => rendererPromise ||= (async () => {
    const pdfjs = await getPdfjsLib(); check(signal)
    loadingTask = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false })
    const pdf = await loadingTask.promise; check(signal); return { pdf, pdfjs }
  })()
  const offset = flattened ? 20 : 0
  try {
    for (let index = 0; index < selection.length; index++) {
      check(signal); onProgress?.(offset + index / selection.length * (92 - offset), `Converting page ${selection[index]} of ${source.pageCount}…`); await tick()
      const number = selection[index], page = pdfDocument.getPage(number - 1), box = pdfDisplayGeometry(page)
      if (options.mode === 'light') { const { pdf, pdfjs } = await renderer(); if (!await hasDarkPaper(pdf, pdfjs, number, signal)) { skipped++; continue } }
      if (options.method === 'preserve') recolourVector(page, box, options)
      else {
        const { pdf, pdfjs } = await renderer(), canvas = await renderBody(pdf, pdfjs, number, Number(options.dpi), signal)
        try {
          await recolourPixels(canvas, options, signal)
          const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode this page.')), options.encoding === 'png' ? 'image/png' : 'image/jpeg', .94))
          check(signal)
          const imageBytes = await blob.arrayBuffer(), image = options.encoding === 'png' ? await pdfDocument.embedPng(imageBytes) : await pdfDocument.embedJpg(imageBytes)
          check(signal)
          // Keep the original page objects and annotation coordinates so links,
          // destinations, form widgets and page boxes keep working.
          page.node.normalize(); page.node.set(PDFName.of('Contents'), pdfDocument.context.obj([]))
          frame(page, box, () => page.drawImage(image, { x: 0, y: 0, width: box.width, height: box.height }))
        } finally { canvas.width = canvas.height = 0 }
      }
      changed++
    }
    check(signal); onProgress?.(96, 'Finishing PDF…'); await tick()
    const output = !changed && !flattened ? source.file : new Blob([await pdfDocument.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 })], { type: 'application/pdf' })
    check(signal); onProgress?.(100, 'PDF ready')
    return { blob: output, changed, skipped, flattened }
  } finally { await loadingTask?.destroy().catch(() => {}) }
}
