import { PDFDocument, PDFName, PDFNumber, StandardFonts, concatTransformationMatrix, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, rgb } from 'pdf-lib'
import { loadPdfBytes } from './pdfEngine'

export const WATERMARK_FONTS = ['Helvetica', 'Times', 'Courier']
export const WATERMARK_POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
export const watermarkDefaults = () => ({ type: 'text', text: 'CONFIDENTIAL', font: 'Helvetica', bold: true, italic: false, fontSize: 48, opacity: 25, rotation: 45, color: '#808080', imageWidth: 35, position: 'center', x: 50, y: 50, margin: 10, repeat: false, gap: 25, autoFit: true, layer: 'over', pagesMode: 'all', range: '' })
const check = signal => { if (signal?.aborted) throw new DOMException('Watermark creation cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const fontNames = { Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] }

export function watermarkPageSelection(options, total) {
  if (options.pagesMode === 'all') return Array.from({ length: total }, (_, index) => index + 1)
  if (options.pagesMode === 'odd' || options.pagesMode === 'even') return Array.from({ length: total }, (_, index) => index + 1).filter(number => number % 2 === (options.pagesMode === 'odd' ? 1 : 0))
  if (options.pagesMode !== 'custom' || !options.range.trim()) throw new Error('Enter pages such as 1-3, 5.')
  const pages = new Set()
  for (const token of options.range.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use page numbers such as 1-3, 5.')
    const start = Number(match[1]), end = Number(match[2] || match[1])
    if (start < 1 || end < start || end > total) throw new Error(`Pages must be between 1 and ${total}.`)
    for (let number = start; number <= end; number++) pages.add(number)
  }
  return [...pages].sort((a, b) => a - b)
}

export function validateWatermark(options, total, image) {
  if (!['text', 'image'].includes(options.type)) throw new Error('Choose text or image watermark.')
  if (options.type === 'text' && !options.text.trim()) throw new Error('Enter watermark text.')
  if (options.type === 'text' && (options.text.length > 500 || options.text.split('\n').length > 5)) throw new Error('Use up to 500 characters and five lines.')
  if (options.type === 'image' && !image?.dataUrl) throw new Error('Choose a watermark image.')
  if (options.type === 'text' && (!WATERMARK_FONTS.includes(options.font) || !/^#[0-9a-f]{6}$/i.test(options.color))) throw new Error('Choose a supported font and colour.')
  const numbers = [['opacity', 'Opacity', 0, 100], ['rotation', 'Rotation', -180, 180], ['margin', 'Margin', 0, 50], ...(options.type === 'text' ? [['fontSize', 'Text size', 8, 144]] : [['imageWidth', 'Image width', 5, 90]]), ...(options.repeat ? [['gap', 'Tile spacing', 5, 100]] : options.position === 'custom' ? [['x', 'Horizontal position', 0, 100], ['y', 'Vertical position', 0, 100]] : [])]
  for (const [key, label, low, high] of numbers) {
    const number = Number(options[key])
    if (String(options[key]).trim() === '' || !Number.isFinite(number) || number < low || number > high) throw new Error(`${label} must be between ${low} and ${high}.`)
  }
  if (!['over', 'under'].includes(options.layer) || ![...WATERMARK_POSITIONS, 'custom'].includes(options.position)) throw new Error('Choose a watermark position and layer.')
  const selection = watermarkPageSelection(options, total)
  if (!selection.length) throw new Error('No pages match this selection.')
  return selection
}

function pageGeometry(page) {
  const media = page.getMediaBox(), crop = page.getCropBox(), rotation = (page.getRotation().angle % 360 + 360) % 360
  const left = Math.max(media.x, crop.x), bottom = Math.max(media.y, crop.y), right = Math.min(media.x + media.width, crop.x + crop.width), top = Math.min(media.y + media.height, crop.y + crop.height)
  const unitValue = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber(), unit = unitValue > 0 ? unitValue : 1
  if (![left, bottom, right, top, unit].every(Number.isFinite) || right <= left || top <= bottom || ![0, 90, 180, 270].includes(rotation)) throw new Error('A page has an unsupported visible area or rotation.')
  const inverseUnit = 1 / unit
  // Map bottom-left display coordinates into the original page coordinates.
  // Keep the page's crop box, rotation, links, widgets and content streams.
  const matrix = rotation === 90 ? [0, inverseUnit, -inverseUnit, 0, right, bottom] : rotation === 180 ? [-inverseUnit, 0, 0, -inverseUnit, right, top] : rotation === 270 ? [0, -inverseUnit, inverseUnit, 0, left, top] : [inverseUnit, 0, 0, inverseUnit, left, bottom]
  return { width: (rotation % 180 ? top - bottom : right - left) * unit, height: (rotation % 180 ? right - left : top - bottom) * unit, matrix }
}

export async function readWatermarkSource(file, { signal, purpose = 'adding a watermark' } = {}) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.')
  const bytes = await loadPdfBytes(file); check(signal)
  let document
  try { document = await PDFDocument.load(bytes, { updateMetadata: false }) }
  catch (error) { throw new Error(/encrypt|password/i.test(error.message) ? `Unlock this PDF before ${purpose}.` : 'Could not open this PDF. Choose a valid PDF document.') }
  const pageCount = document.getPageCount()
  if (!pageCount) throw new Error('This PDF has no pages.')
  document.getPages().forEach(pageGeometry); check(signal)
  return { file, bytes, pageCount }
}

async function textMeasurer(document, options, signal) {
  const base = await document.embedFont(StandardFonts[fontNames[options.font][Number(options.bold) + Number(options.italic) * 2]])
  let unicode
  const coverage = new Map(), cache = new Map()
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const supports = (font, cluster) => {
    if (!coverage.has(font)) coverage.set(font, new Set(font.getCharacterSet()))
    return Array.from(cluster).every(character => coverage.get(font).has(character.codePointAt(0)) || /[\u200c\u200d\ufe0f]/.test(character))
  }
  return async value => {
    if (cache.has(value)) return cache.get(value)
    const lines = []
    for (const text of value.split('\n')) {
      const clusters = segmenter ? Array.from(segmenter.segment(text), entry => entry.segment) : Array.from(text), runs = []
      for (const cluster of clusters) {
        let font = base
        if (!supports(base, cluster)) {
          if (!unicode) { const { embedUnicodeFonts } = await import('./unicodePdf'); unicode = await embedUnicodeFonts(document); check(signal) }
          font = Object.values(unicode.scripts).map(family => options.bold ? family.bold : family.regular).find(candidate => supports(candidate, cluster))
          if (!font) throw new Error('This text contains characters the available fonts cannot display. Choose different text.')
        }
        if (runs.at(-1)?.font === font) runs.at(-1).text += cluster
        else runs.push({ font, text: cluster })
      }
      const width = runs.reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, 1), 0)
      lines.push({ runs, width })
    }
    const fonts = [...new Set([base, ...lines.flatMap(line => line.runs.map(run => run.font))])]
    const ascent = Math.max(...fonts.map(font => font.heightAtSize(1, { descender: false }))), descent = Math.max(...fonts.map(font => font.heightAtSize(1) - font.heightAtSize(1, { descender: false })))
    const layout = { lines, width: Math.max(...lines.map(line => line.width)), height: ascent + descent + (lines.length - 1) * 1.25, ascent }
    cache.set(value, layout); return layout
  }
}

export { pageGeometry as pdfDisplayGeometry, textMeasurer as createPdfTextMeasurer }

function placement(options, box, markWidth, markHeight) {
  const radians = Number(options.rotation) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians), margin = Math.min(Number(options.margin) * 72 / 25.4, Math.min(box.width, box.height) * .2)
  const boundWidth = Math.abs(markWidth * cos) + Math.abs(markHeight * sin), boundHeight = Math.abs(markWidth * sin) + Math.abs(markHeight * cos)
  let fit = 1
  if (options.autoFit) fit = Math.min(1, (box.width - margin * 2) / boundWidth, (box.height - margin * 2) / boundHeight)
  const width = markWidth * fit, height = markHeight * fit, rotatedWidth = boundWidth * fit, rotatedHeight = boundHeight * fit
  if (options.repeat) {
    const gap = Number(options.gap) * 72 / 25.4, availableWidth = box.width - margin * 2, availableHeight = box.height - margin * 2
    const columns = Math.max(1, Math.floor((availableWidth + gap) / (rotatedWidth + gap))), rows = Math.max(1, Math.floor((availableHeight + gap) / (rotatedHeight + gap)))
    if (columns * rows > 500) throw new Error('Increase tile spacing or watermark size to use fewer than 500 marks per page.')
    return { width, height, fit, cos, sin, centers: Array.from({ length: columns * rows }, (_, index) => ({ x: margin + (index % columns + .5) * availableWidth / columns, y: margin + (Math.floor(index / columns) + .5) * availableHeight / rows })) }
  }
  let x = box.width / 2, y = box.height / 2
  if (options.position === 'custom') { x = box.width * Number(options.x) / 100; y = box.height * (1 - Number(options.y) / 100) }
  else {
    if (options.position.endsWith('left')) x = margin + rotatedWidth / 2
    if (options.position.endsWith('right')) x = box.width - margin - rotatedWidth / 2
    if (options.position.startsWith('top')) y = box.height - margin - rotatedHeight / 2
    if (options.position.startsWith('bottom')) y = margin + rotatedHeight / 2
  }
  return { width, height, fit, cos, sin, centers: [{ x, y }] }
}

export async function createWatermarkedPdf(source, options, image, { signal, onProgress } = {}) {
  const selection = validateWatermark(options, source.pageCount, image); check(signal)
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false }); check(signal)
  const measure = options.type === 'text' ? await textMeasurer(document, options, signal) : null
  const logo = options.type === 'image' ? await document.embedPng(image.dataUrl) : null
  const color = options.type === 'text' ? rgb(...[1, 3, 5].map(offset => parseInt(options.color.slice(offset, offset + 2), 16) / 255)) : rgb(0, 0, 0), opacity = Number(options.opacity) / 100
  for (let index = 0; index < selection.length; index++) {
    check(signal); onProgress?.(Math.round(index / selection.length * 90), `Watermarking page ${selection[index]}…`); await tick()
    const number = selection[index], page = document.getPage(number - 1), box = pageGeometry(page)
    const text = options.type === 'text' ? options.text.replace(/\r/g, '').replace(/\t/g, '    ').trim().replaceAll('{page}', String(number)).replaceAll('{total}', String(source.pageCount)) : ''
    const layout = measure ? await measure(text) : null
    const markWidth = layout ? layout.width * Number(options.fontSize) : box.width * Number(options.imageWidth) / 100, markHeight = layout ? layout.height * Number(options.fontSize) : markWidth * logo.height / logo.width
    const placed = placement(options, box, markWidth, markHeight)
    page.node.normalize()
    const previous = page.node.Contents()?.asArray().slice() || []
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...box.matrix), rectangle(0, 0, box.width, box.height), clip(), endPath())
    for (const center of placed.centers) {
      check(signal)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(placed.cos, placed.sin, -placed.sin, placed.cos, center.x, center.y))
      if (layout) {
        const size = Number(options.fontSize) * placed.fit
        layout.lines.forEach((line, lineIndex) => {
          let x = -line.width * size / 2
          const y = placed.height / 2 - layout.ascent * size - lineIndex * size * 1.25
          for (const run of line.runs) { page.drawText(run.text, { x, y, size, font: run.font, color, opacity }); x += run.font.widthOfTextAtSize(run.text, size) }
        })
      } else page.drawImage(logo, { x: -placed.width / 2, y: -placed.height / 2, width: placed.width, height: placed.height, opacity })
      page.pushOperators(popGraphicsState())
    }
    page.pushOperators(popGraphicsState())
    if (options.layer === 'under') {
      const old = new Set(previous.map(ref => ref.toString())), added = page.node.Contents().asArray().filter(ref => !old.has(ref.toString()))
      page.node.set(PDFName.of('Contents'), document.context.obj([...added, ...previous]))
    }
  }
  check(signal); onProgress?.(95, 'Finishing PDF…'); await tick()
  const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 }); check(signal); onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
