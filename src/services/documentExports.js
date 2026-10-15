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

function safeLink(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

async function pageLinks(page, document, viewport) {
  const links = []
  for (const annotation of await page.getAnnotations({ intent: 'display' })) {
    if (annotation.subtype !== 'Link' || !annotation.rect) continue
    let href = safeLink(annotation.url || '')
    if (!href && annotation.dest) {
      const destination = typeof annotation.dest === 'string' ? await document.getDestination(annotation.dest) : annotation.dest
      if (destination?.[0] != null) {
        const index = typeof destination[0] === 'number' ? destination[0] : await document.getPageIndex(destination[0])
        href = `#page-${index + 1}`
      }
    }
    if (!href) continue
    const matrix = viewport.transform
    const corners = [[annotation.rect[0], annotation.rect[1]], [annotation.rect[2], annotation.rect[3]]].map(([horizontal, vertical]) => [matrix[0] * horizontal + matrix[2] * vertical + matrix[4], matrix[1] * horizontal + matrix[3] * vertical + matrix[5]])
    links.push({ href, x: Math.min(corners[0][0], corners[1][0]), y: Math.min(corners[0][1], corners[1][1]), width: Math.abs(corners[1][0] - corners[0][0]), height: Math.abs(corners[1][1] - corners[0][1]) })
  }
  return links
}

export async function pdfToHtml(file, options = {}, progress = () => {}) {
  const { pdfjs, document, loadingTask } = await openPdf(file)
  const zip = new JSZip()
  const sections = []
  try {
    const pages = selectedPages(options.pageRange || '', document.numPages)
    for (const [index, pageNumber] of pages.entries()) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const canvas = await renderPageToCanvas(document, pageNumber, 1.5)
      const imageData = canvas.toDataURL('image/png')
      const imagePath = `assets/page-${pageNumber}.png`
      if (options.packageAssets) zip.file(imagePath, imageData.split(',')[1], { base64: true })
      const spans = content.items.filter((item) => item.str?.trim()).map((item) => {
        const matrix = pdfjs.Util.transform(viewport.transform, item.transform)
        const size = Math.max(1, Math.hypot(matrix[2], matrix[3]))
        return `<span style="left:${matrix[4]}px;top:${matrix[5] - size}px;font-size:${size}px">${escapeMarkup(item.str)}</span>`
      }).join('')
      const links = (await pageLinks(page, document, viewport)).map((link) => `<a href="${escapeMarkup(link.href)}" aria-label="Open link" style="left:${link.x}px;top:${link.y}px;width:${link.width}px;height:${link.height}px"${link.href.startsWith('#') ? '' : ' rel="noopener noreferrer"'}></a>`).join('')
      sections.push(`<section class="pdf-page" id="page-${pageNumber}" aria-label="Page ${pageNumber}" style="width:${viewport.width}px;height:${viewport.height}px"><img src="${options.packageAssets ? imagePath : imageData}" alt=""/><div class="text-layer">${spans}</div><div class="link-layer">${links}</div></section>`)
      canvas.width = canvas.height = 0
      page.cleanup()
      progress(Math.round((index + 1) / pages.length * 95))
    }
    const title = escapeMarkup(options.title || file.name.replace(/\.pdf$/i, ''))
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;padding:24px;background:#e5e7eb;font-family:Arial,sans-serif}.pdf-page{position:relative;margin:0 auto 24px;background:#fff;box-shadow:0 2px 12px #0002;overflow:hidden}.pdf-page>img{position:absolute;width:100%;height:100%}.text-layer span{position:absolute;color:transparent;white-space:pre;line-height:1;transform-origin:0 0}.text-layer span::selection{background:#93c5fd;color:transparent}.link-layer a{position:absolute;display:block}.link-layer a:focus{outline:2px solid #2563eb}@media print{body{padding:0;background:#fff}.pdf-page{margin:0;box-shadow:none;break-after:page}}</style></head><body>${sections.join('')}</body></html>`
    if (options.packageAssets) {
      zip.file('index.html', html)
      return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), extension: 'zip' }
    }
    return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), extension: 'html' }
  } finally { await loadingTask.destroy() }
}

function readingContent(content, pdfjs, viewport) {
  const items = content.items.filter((item) => item.str?.trim()).map((item) => {
    const transform = pdfjs.Util.transform(viewport.transform, item.transform)
    return { text: item.str, x: transform[4], y: transform[5], size: Math.max(1, Math.hypot(transform[2], transform[3])) }
  }).sort((left, right) => left.y - right.y || left.x - right.x)
  const lines = []
  for (const item of items) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= Math.max(3, item.size * .3))
    if (line) line.items.push(item)
    else lines.push({ y: item.y, items: [item] })
  }
  lines.forEach((line) => line.items.sort((left, right) => left.x - right.x))
  const sizes = items.map((item) => item.size).sort((left, right) => left - right)
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 11
  const blocks = []
  let tableRows = []
  const flushTable = () => { if (tableRows.length) blocks.push(`<table><tbody>${tableRows.join('')}</tbody></table>`); tableRows = [] }
  for (const line of lines) {
    if (line.items.length >= 3) { tableRows.push(`<tr>${line.items.map((item) => `<td>${escapeMarkup(item.text)}</td>`).join('')}</tr>`); continue }
    flushTable()
    const text = line.items.map((item) => item.text).join(' ')
    const heading = Math.max(...line.items.map((item) => item.size)) > bodySize * 1.3
    blocks.push(`<${heading ? 'h2' : 'p'}>${escapeMarkup(text)}</${heading ? 'h2' : 'p'}>`)
  }
  flushTable()
  return { html: blocks.join(''), title: lines.find((line) => line.items.some((item) => item.size > bodySize * 1.3))?.items.map((item) => item.text).join(' ') || '', hasText: items.length > 0 }
}

export async function pdfToEpub(file, options = {}, progress = () => {}) {
  const { pdfjs, document, loadingTask } = await openPdf(file)
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  const title = escapeMarkup(options.title || file.name.replace(/\.pdf$/i, ''))
  const fontFamily = options.fontFamily === 'sans-serif' ? 'sans-serif' : 'serif'
  const fontSize = Math.max(80, Math.min(160, Number(options.fontSize || 100)))
  const lineHeight = Math.max(1.2, Math.min(2, Number(options.lineHeight || 1.5)))
  zip.file('EPUB/styles.css', `body{font-family:${fontFamily};font-size:${fontSize}%;line-height:${lineHeight};margin:5%}p{margin:.5em 0}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td{padding:.3em;border:1px solid #aaa}h1,h2{line-height:1.2;break-after:avoid}`)
  const chapters = []
  const assets = []
  try {
    const pages = selectedPages(options.pageRange || '', document.numPages)
    for (const [index, pageNumber] of pages.entries()) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = readingContent(await page.getTextContent(), pdfjs, viewport)
      let body = content.html
      if (!content.hasText || options.readingLayout === 'pages') {
        const canvas = await renderPageToCanvas(document, pageNumber, 1.5)
        const imageName = `page-${pageNumber}.png`
        zip.file(`EPUB/${imageName}`, canvas.toDataURL('image/png').split(',')[1], { base64: true })
        assets.push(`<item id="image-${pageNumber}" href="${imageName}" media-type="image/png"/>`)
        body = `<p><img src="${imageName}" alt="Page ${pageNumber}"/></p>${options.readingLayout === 'pages' ? '' : body}`
        canvas.width = canvas.height = 0
      }
      const label = `Page ${pageNumber}${content.title ? `: ${content.title}` : ''}`
      const filename = `page-${pageNumber}.xhtml`
      zip.file(`EPUB/${filename}`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><title>${escapeMarkup(label)}</title><link href="styles.css" rel="stylesheet" type="text/css"/></head><body><section id="page-${pageNumber}">${body || '<p>Blank page</p>'}</section></body></html>`)
      chapters.push({ id: `page-${pageNumber}`, filename, label })
      page.cleanup()
      progress(Math.round((index + 1) / pages.length * 90))
    }
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('EPUB/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((chapter) => `<li><a href="${chapter.filename}">${escapeMarkup(chapter.label)}</a></li>`).join('')}</ol></nav></body></html>`)
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    zip.file('EPUB/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles.css" media-type="text/css"/>${chapters.map((chapter) => `<item id="${chapter.id}" href="${chapter.filename}" media-type="application/xhtml+xml"/>`).join('')}${assets.join('')}</manifest><spine>${chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('')}</spine></package>`)
    return { blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' }), extension: 'epub' }
  } finally { await loadingTask.destroy() }
}

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
