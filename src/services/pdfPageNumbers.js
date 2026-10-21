import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, rgb } from 'pdf-lib'
import { createPdfTextMeasurer, pdfDisplayGeometry, readWatermarkSource, watermarkPageSelection, WATERMARK_FONTS } from './pdfWatermark'

export const NUMBER_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']
export const NUMBER_FORMATS = { number: '{number}', page: 'Page {number}', fraction: '{number} / {total}', full: 'Page {number} of {total}' }
export const NUMBER_STYLES = { decimal: '1, 2, 3', padded: '01, 02, 03', 'roman-lower': 'i, ii, iii', 'roman-upper': 'I, II, III', 'alpha-lower': 'a, b, c', 'alpha-upper': 'A, B, C' }
export const pageNumberDefaults = () => ({ format: 'number', template: 'Page {number} of {total}', numberStyle: 'decimal', startAt: 1, firstPage: 1, countMode: 'selected', pagesMode: 'all', range: '', position: 'bottom-center', mirror: false, font: 'Helvetica', fontSize: 10, bold: false, italic: false, color: '#333333', margin: 8 })
const check = signal => { if (signal?.aborted) throw new DOMException('Page numbering cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

export function formatPageNumber(number, style) {
  if (style === 'padded') return String(number).padStart(2, '0')
  if (style?.startsWith('roman-')) {
    if (!Number.isInteger(number) || number < 1 || number > 3999) throw new Error('Roman numbers must be between 1 and 3999.')
    let result = '', remaining = number
    for (const [value, text] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
      while (remaining >= value) { result += text; remaining -= value }
    }
    return style === 'roman-lower' ? result.toLowerCase() : result
  }
  if (style?.startsWith('alpha-')) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Letter numbering must start at 1 or higher.')
    let result = '', remaining = number
    while (remaining > 0) { remaining--; result = String.fromCharCode(65 + remaining % 26) + result; remaining = Math.floor(remaining / 26) }
    return style === 'alpha-lower' ? result.toLowerCase() : result
  }
  return String(number)
}

export function validatePageNumbers(options, pageCount) {
  for (const [key, label, low, high, integer] of [['firstPage', 'First numbered page', 1, pageCount, true], ['startAt', 'Start number', 0, 999999999, true], ['fontSize', 'Text size', 6, 72, false], ['margin', 'Edge margin', 0, 50, false]]) {
    const value = Number(options[key])
    if (String(options[key]).trim() === '' || !Number.isFinite(value) || value < low || value > high || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between ${low} and ${high}.`)
  }
  if (!NUMBER_POSITIONS.includes(options.position) || !WATERMARK_FONTS.includes(options.font) || !/^#[0-9a-f]{6}$/i.test(options.color)) throw new Error('Choose a valid position, font and colour.')
  if (!Object.hasOwn(NUMBER_STYLES, options.numberStyle) || !['selected', 'document'].includes(options.countMode)) throw new Error('Choose a numbering style and sequence.')
  const template = options.format === 'custom' ? options.template : NUMBER_FORMATS[options.format]
  if (typeof template !== 'string' || !template.trim() || template.length > 200 || /[\r\n\t]/.test(template)) throw new Error('Use a single-line number format, up to 200 characters.')
  if (!/\{(?:number|page)\}/.test(template)) throw new Error('Include {number} or {page} in your format.')
  if (/\{[^{}]*\}/.test(template.replace(/\{(?:number|total|page|pages|count)\}/g, ''))) throw new Error('Use {number}, {total}, {page}, {pages} or {count}.')
  const selection = watermarkPageSelection(options, pageCount).filter(page => page >= Number(options.firstPage))
  if (!selection.length) throw new Error('No pages match these settings.')
  const lastNumber = Number(options.startAt) + (options.countMode === 'selected' ? selection.length - 1 : pageCount - Number(options.firstPage))
  if (lastNumber > 999999999) throw new Error('The last number must be 999999999 or less.')
  formatPageNumber(Number(options.startAt), options.numberStyle); formatPageNumber(lastNumber, options.numberStyle)
  return { selection, indices: new Map(selection.map((page, index) => [page, index])), template, lastNumber }
}

export function pageNumberLabel(options, plan, page, pageCount) {
  const index = plan.indices.get(page)
  if (index == null) return ''
  const number = Number(options.startAt) + (options.countMode === 'document' ? page - Number(options.firstPage) : index)
  const values = { number: formatPageNumber(number, options.numberStyle), total: formatPageNumber(plan.lastNumber, options.numberStyle), page: String(page), pages: String(pageCount), count: String(plan.selection.length) }
  return plan.template.replace(/\{(number|total|page|pages|count)\}/g, (_, key) => values[key])
}

export const readPageNumberSource = (file, config = {}) => readWatermarkSource(file, { ...config, purpose: 'adding page numbers' })

export async function createNumberedPdf(source, options, { signal, onProgress } = {}) {
  const plan = validatePageNumbers(options, source.pageCount); check(signal)
  const stamps = plan.selection.map(page => ({ page, label: pageNumberLabel(options, plan, page, source.pageCount) }))
  return createTextStampedPdf(source, options, stamps, { signal, onProgress })
}

// Append selectable labels to the original pages, without rebuilding their contents.
export async function createTextStampedPdf(source, options, stamps, { signal, onProgress } = {}) {
  check(signal)
  if (!stamps.length) return source.file
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false }); check(signal)
  const measure = await createPdfTextMeasurer(document, options, signal)
  const color = rgb(...[1, 3, 5].map(offset => parseInt(options.color.slice(offset, offset + 2), 16) / 255))
  for (let index = 0; index < stamps.length; index++) {
    check(signal); onProgress?.(Math.round(index / stamps.length * 90), `Stamping page ${stamps[index].page}…`); await tick()
    const { page: physical, label } = stamps[index], page = document.getPage(physical - 1), box = pdfDisplayGeometry(page)
    const layout = await measure(label); check(signal)
    const margin = Number(options.margin) * 72 / 25.4, size = Number(options.fontSize)
    const textWidth = layout.width * size, textHeight = layout.height * size
    if (textWidth > box.width - 2 * margin || textHeight > box.height - 2 * margin) throw new Error(`Page ${physical}: the stamp does not fit. Reduce text size or edge margin.`)
    let position = options.position
    // Mirrored positions follow physical sheet parity, including unnumbered covers.
    if (options.mirror && physical % 2 === 0) position = position.endsWith('left') ? position.replace('left', 'right') : position.endsWith('right') ? position.replace('right', 'left') : position
    let x = position.endsWith('left') ? margin : position.endsWith('right') ? box.width - margin - textWidth : (box.width - textWidth) / 2
    const baseline = position.startsWith('top') ? box.height - margin - layout.ascent * size : margin + (layout.height - layout.ascent) * size
    page.node.normalize()
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...box.matrix), rectangle(0, 0, box.width, box.height), clip(), endPath())
    for (const run of layout.lines[0].runs) { page.drawText(run.text, { x, y: baseline, size, font: run.font, color }); x += run.font.widthOfTextAtSize(run.text, size) }
    page.pushOperators(popGraphicsState())
  }
  check(signal); onProgress?.(95, 'Finishing PDF…'); await tick()
  const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 }); check(signal)
  onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
