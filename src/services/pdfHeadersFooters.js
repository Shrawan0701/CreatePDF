import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, rgb } from 'pdf-lib'
import { createPdfTextMeasurer, pdfDisplayGeometry, readWatermarkSource, watermarkPageSelection, WATERMARK_FONTS } from './pdfWatermark'

export const HEADER_FOOTER_FIELDS = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight']
export const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
export const headersFootersDefaults = () => ({ ...Object.fromEntries(HEADER_FOOTER_FIELDS.map(field => [field, ''])), font: 'Helvetica', fontSize: 9, bold: false, italic: false, color: '#333333', horizontalMargin: 10, verticalMargin: 8, autoFit: true, headerRule: false, footerRule: false, mirror: false, pagesMode: 'all', range: '', skipCover: false, date: localDate(), dateFormat: 'iso' })
const check = signal => { if (signal?.aborted) throw new DOMException('Header and footer creation cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

export function validateHeadersFooters(options, total) {
  if (!HEADER_FOOTER_FIELDS.some(field => options[field]?.trim())) throw new Error('Enter a header or footer.')
  for (const field of HEADER_FOOTER_FIELDS) {
    const text = options[field]
    if (typeof text !== 'string' || text.length > 200 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('Use single-line text, up to 200 characters per field.')
    if (/\{[^{}]*\}/.test(text.replace(/\{(?:page|total|date|filename)\}/g, ''))) throw new Error('Supported inserts: {page}, {total}, {date}, {filename}.')
  }
  if (!WATERMARK_FONTS.includes(options.font) || !/^#[0-9a-f]{6}$/i.test(options.color)) throw new Error('Choose a valid font and colour.')
  for (const [key, label, low, high] of [['fontSize', 'Text size', 6, 36], ['horizontalMargin', 'Side margin', 0, 50], ['verticalMargin', 'Top and bottom margin', 0, 50]]) {
    const value = Number(options[key])
    if (String(options[key]).trim() === '' || !Number.isFinite(value) || value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}.`)
  }
  if (HEADER_FOOTER_FIELDS.some(field => options[field].includes('{date}'))) {
    const date = new Date(`${options.date}T12:00:00`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || Number.isNaN(date.getTime()) || `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` !== options.date || !['iso', 'dmy', 'mdy'].includes(options.dateFormat)) throw new Error('Choose a valid date and date format.')
  }
  const selection = watermarkPageSelection(options, total).filter(page => !options.skipCover || page > 1)
  if (!selection.length) throw new Error('No pages match these settings.')
  return selection
}

export function resolveHeaderFooter(text, source, options, page) {
  const [year, month, day] = options.date.split('-')
  const date = options.dateFormat === 'dmy' ? `${day}/${month}/${year}` : options.dateFormat === 'mdy' ? `${month}/${day}/${year}` : options.date
  const values = { page: String(page), total: String(source.pageCount), date, filename: source.file.name.replace(/\.pdf$/i, '').replace(/[\u0000-\u001f\u007f]/g, ' ') }
  // Replace in a single pass: braces in a file name remain literal text.
  return text.replace(/\{(page|total|date|filename)\}/g, (_, token) => values[token])
}

function layoutRow(items, box, options, physical) {
  const side = Number(options.horizontalMargin) * 72 / 25.4, edge = Number(options.verticalMargin) * 72 / 25.4
  const available = box.width - 2 * side, baseSize = Number(options.fontSize), gap = 6
  const [left, center, right] = items, widths = items.map(item => item ? item.width * baseSize : 0)
  if (available <= 0) throw new Error(`Page ${physical}: reduce the side margin.`)
  let fit = Math.min(1, ...widths.filter(Boolean).map(width => available / width))
  if (left && center) fit = Math.min(fit, (available / 2 - gap) / (widths[0] + widths[1] / 2))
  if (center && right) fit = Math.min(fit, (available / 2 - gap) / (widths[1] / 2 + widths[2]))
  if (left && right) fit = Math.min(fit, (available - gap) / (widths[0] + widths[2]))
  if ((!options.autoFit && fit < .9999) || fit * baseSize < 6 - .0001) throw new Error(`Page ${physical}: header or footer text overlaps. Shorten it, reduce text size or reduce margins.`)
  const size = options.autoFit ? baseSize * fit : baseSize
  const present = items.filter(Boolean), ascent = Math.max(0, ...present.map(item => item.ascent)) * size, descent = Math.max(0, ...present.map(item => item.height - item.ascent)) * size, height = ascent + descent
  if (height + 2 * edge > box.height) throw new Error(`Page ${physical}: reduce the top and bottom margin.`)
  return { items, size, ascent, descent, height, side, edge }
}

export const readHeaderFooterSource = (file, config = {}) => readWatermarkSource(file, { ...config, purpose: 'adding headers and footers' })

export async function createHeadersFootersPdf(source, options, { signal, onProgress } = {}) {
  const selection = validateHeadersFooters(options, source.pageCount); check(signal)
  const document = await PDFDocument.load(source.bytes, { updateMetadata: false }); check(signal)
  const measure = await createPdfTextMeasurer(document, options, signal), color = rgb(...[1, 3, 5].map(offset => parseInt(options.color.slice(offset, offset + 2), 16) / 255))
  for (let index = 0; index < selection.length; index++) {
    check(signal); onProgress?.(Math.round(index / selection.length * 90), `Updating page ${selection[index]}…`); await tick()
    const physical = selection[index], page = document.getPage(physical - 1), box = pdfDisplayGeometry(page), rows = []
    for (const type of ['header', 'footer']) {
      const keys = ['Left', 'Center', 'Right'].map(align => `${type}${align}`)
      const items = []
      for (const key of keys) { const text = resolveHeaderFooter(options[key], source, options, physical).trim(); items.push(text ? await measure(text) : null); check(signal) }
      if (options.mirror && physical % 2 === 0) [items[0], items[2]] = [items[2], items[0]]
      rows.push(layoutRow(items, box, options, physical))
    }
    const [header, footer] = rows, headerPresent = header.items.some(Boolean), footerPresent = footer.items.some(Boolean)
    const topExtent = headerPresent ? header.edge + header.height + (options.headerRule ? 5 : 0) : 0, bottomExtent = footerPresent ? footer.edge + footer.height + (options.footerRule ? 5 : 0) : 0
    if (topExtent + bottomExtent + 6 > box.height) throw new Error(`Page ${physical}: header and footer areas overlap. Reduce margins or text size.`)
    page.node.normalize()
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...box.matrix), rectangle(0, 0, box.width, box.height), clip(), endPath())
    rows.forEach((row, rowIndex) => {
      const top = rowIndex === 0, baseline = top ? box.height - row.edge - row.ascent : row.edge + row.descent
      row.items.forEach((layout, align) => {
        if (!layout) return
        const width = layout.width * row.size
        let x = align === 0 ? row.side : align === 1 ? (box.width - width) / 2 : box.width - row.side - width
        for (const run of layout.lines[0].runs) { page.drawText(run.text, { x, y: baseline, size: row.size, font: run.font, color }); x += run.font.widthOfTextAtSize(run.text, row.size) }
      })
      if (row.items.some(Boolean) && (top ? options.headerRule : options.footerRule)) {
        const y = top ? baseline - row.descent - 4 : baseline + row.ascent + 4
        page.drawLine({ start: { x: row.side, y }, end: { x: box.width - row.side, y }, thickness: .5, color })
      }
    })
    page.pushOperators(popGraphicsState())
  }
  check(signal); onProgress?.(95, 'Finishing PDF…'); await tick()
  const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 }); check(signal); onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
