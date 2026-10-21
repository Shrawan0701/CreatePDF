import { createTextStampedPdf, NUMBER_POSITIONS } from './pdfPageNumbers'
import { readWatermarkSource, watermarkPageSelection, WATERMARK_FONTS } from './pdfWatermark'

export const batesDefaults = () => ({ prefix: 'DOC-', suffix: '', start: '1', padding: 6, sequence: 'continuous', position: 'bottom-right', font: 'Courier', fontSize: 9, color: '#333333', bold: false, italic: false, margin: 8, mirror: false, pagesMode: 'all', skipCover: false })
const MAX_NUMBER = 999999999999999999n

export function batesLabel(number, options) {
  return `${options.prefix}${String(number).padStart(Number(options.padding), '0')}${options.suffix}`
}

export function planBatesBatch(entries, options) {
  if (!entries.length) throw new Error('Add a PDF to stamp.')
  if (!/^\d{1,18}$/.test(String(options.start))) throw new Error('Start number must contain 1–18 digits.')
  for (const [key, label, low, high, integer] of [['padding', 'Digit padding', 1, 18, true], ['fontSize', 'Text size', 6, 72, false], ['margin', 'Edge margin', 0, 50, false]]) {
    const value = Number(options[key])
    if (String(options[key]).trim() === '' || !Number.isFinite(value) || value < low || value > high || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between ${low} and ${high}.`)
  }
  for (const value of [options.prefix, options.suffix]) {
    if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Use a single-line prefix and suffix, up to 100 characters each.')
  }
  if (!NUMBER_POSITIONS.includes(options.position) || !WATERMARK_FONTS.includes(options.font) || !/^#[0-9a-f]{6}$/i.test(options.color)) throw new Error('Choose a valid position, font and colour.')
  if (!['continuous', 'restart'].includes(options.sequence) || !['all', 'odd', 'even'].includes(options.pagesMode)) throw new Error('Choose a numbering sequence and page selection.')
  let next = BigInt(options.start), stampCount = 0
  const files = entries.map(entry => {
    let selection
    try {
      selection = watermarkPageSelection({ pagesMode: entry.range.trim() ? 'custom' : 'all', range: entry.range }, entry.source.pageCount)
        .filter(page => (!options.skipCover || page > 1) && (options.pagesMode === 'all' || page % 2 === (options.pagesMode === 'odd' ? 1 : 0)))
    } catch (failure) { throw new Error(`${entry.source.file.name}: ${failure.message}`) }
    const firstNumber = options.sequence === 'restart' ? BigInt(options.start) : next
    const lastNumber = firstNumber + BigInt(selection.length) - 1n
    if (selection.length && lastNumber > MAX_NUMBER) throw new Error('The final Bates number exceeds 18 digits. Use a lower start number.')
    if (options.sequence === 'continuous') next += BigInt(selection.length)
    stampCount += selection.length
    return { entry, selection, indices: new Map(selection.map((page, index) => [page, index])), firstNumber, firstLabel: selection.length ? batesLabel(firstNumber, options) : '', lastLabel: selection.length ? batesLabel(lastNumber, options) : '' }
  })
  if (!stampCount) throw new Error('No pages match these settings.')
  const stamped = files.filter(file => file.selection.length)
  return { files, stampCount, firstLabel: stamped[0].firstLabel, lastLabel: stamped.at(-1).lastLabel }
}

export function batesPageLabel(filePlan, page, options) {
  const index = filePlan?.indices.get(page)
  return index == null ? '' : batesLabel(filePlan.firstNumber + BigInt(index), options)
}

export const readBatesSource = (file, config = {}) => readWatermarkSource(file, { ...config, purpose: 'adding Bates stamps' })

export function createBatesPdf(filePlan, options, config) {
  const stamps = filePlan.selection.map((page, index) => ({ page, label: batesLabel(filePlan.firstNumber + BigInt(index), options) }))
  return createTextStampedPdf(filePlan.entry.source, options, stamps, config)
}
