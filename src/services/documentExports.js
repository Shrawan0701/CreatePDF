import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { extractLayout, getPdfjsLib, loadPdfBytes, renderPageToCanvas } from './pdfEngine'
import { formatCsv } from './csv'

export const escapeMarkup = (value) => [...String(value ?? '')].filter((character) => character.codePointAt(0) >= 32 || [9, 10, 13].includes(character.codePointAt(0))).join('').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function selectedPages(range, count) {
  if (!range.trim()) return Array.from({ length: count }, (_, index) => index + 1)
  const pages = new Set()
  for (const token of range.split(',').map((part) => part.trim())) {
    if (!/^\d+(?:\s*-\s*\d+)?$/.test(token)) throw new Error('Enter pages such as 1-3, 5, 8.')
    const [first, last = first] = token.split('-').map(Number)
    if (first < 1 || last < first || last > count) throw new Error(`Page selection must be between 1 and ${count}.`)
    for (let page = first; page <= last; page++) pages.add(page)
  }
  return [...pages].sort((left, right) => left - right)
}

async function openPdf(file) {
  const pdfjs = await getPdfjsLib()
  const loadingTask = pdfjs.getDocument({ data: await loadPdfBytes(file) })
  const document = await loadingTask.promise
  return { pdfjs, document, loadingTask }
}

export { pdfToHtml } from './pdfToHtml'

export { pdfToEpub } from './pdfToEpub'

export async function pdfToPresentation(file, options = {}, progress = () => {}) {
  const { document, loadingTask } = await openPdf(file)
  try {
    const PptxGenJS = (await import('pptxgenjs')).default
    const presentation = new PptxGenJS()
    const pages = selectedPages(options.pageRange || '', document.numPages)
    const first = await document.getPage(pages[0])
    const viewport = first.getViewport({ scale: 1 })
    const width = 10
    const height = Math.max(1, Math.min(40, width * viewport.height / viewport.width))
    presentation.defineLayout({ name: 'PDF_PAGES', width, height })
    presentation.layout = 'PDF_PAGES'
    presentation.title = file.name.replace(/\.pdf$/i, '')
    for (const [index, pageNumber] of pages.entries()) {
      const canvas = await renderPageToCanvas(document, pageNumber, 1.5)
      const scale = Math.min(width / canvas.width, height / canvas.height)
      const imageWidth = canvas.width * scale
      const imageHeight = canvas.height * scale
      presentation.addSlide().addImage({ data: canvas.toDataURL('image/png'), x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, w: imageWidth, h: imageHeight })
      canvas.width = canvas.height = 0
      progress(Math.round((index + 1) / pages.length * 95))
    }
    return { blob: await presentation.write({ outputType: 'blob' }), extension: 'pptx' }
  } finally { await loadingTask.destroy() }
}

function tableRows(lines, tablesOnly) {
  const candidates = tablesOnly ? lines.filter((line) => line.items.length >= 2) : lines
  const positions = []
  for (const line of candidates) for (const item of line.items) {
    if (!positions.some((position) => Math.abs(position - item.x) < 12)) positions.push(item.x)
  }
  positions.sort((left, right) => left - right)
  return candidates.map((line) => {
    const row = Array(positions.length).fill('')
    for (const item of line.items) {
      const column = positions.reduce((best, position, index) => Math.abs(position - item.x) < Math.abs(positions[best] - item.x) ? index : best, 0)
      row[column] = row[column] ? `${row[column]} ${item.text}` : item.text
    }
    return row
  })
}

export async function pdfToWorkbook(file, options = {}, progress = () => {}) {
  const pages = await extractLayout(file, (value) => progress(value * .7))
  const chosen = selectedPages(options.pageRange || '', pages.length)
  const workbook = new ExcelJS.Workbook()
  const csvFiles = []
  for (const pageNumber of chosen) {
    const rows = tableRows(pages[pageNumber - 1].lines, options.tablesOnly !== false)
    if (!rows.length) continue
    const sheet = workbook.addWorksheet(`Page ${pageNumber}`)
    rows.forEach((row) => sheet.addRow(row))
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((column, index) => { column.width = Math.min(60, rows.reduce((width, row) => Math.max(width, String(row[index] || '').length + 2), 10)) })
    csvFiles.push({ name: `page-${pageNumber}.csv`, content: formatCsv(rows) })
  }
  if (!workbook.worksheets.length) throw new Error('No table rows were detected in these pages. Try including all text rows or use a text-based PDF.')
  progress(90)
  if (options.outputFormat === 'csv') {
    if (csvFiles.length === 1) return { blob: new Blob([csvFiles[0].content], { type: 'text/csv;charset=utf-8' }), extension: 'csv' }
    const zip = new JSZip()
    csvFiles.forEach((file) => zip.file(file.name, file.content))
    return { blob: await zip.generateAsync({ type: 'blob' }), extension: 'zip' }
  }
  return { blob: new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), extension: 'xlsx' }
}
