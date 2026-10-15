import DOMPurify from 'dompurify'
import { getPdfLib } from './pdfEngine'
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from './unicodePdf'

export function sanitizeDocumentHtml(markup) {
  const clean = DOMPurify.sanitize(markup, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'video', 'audio', 'style', 'link', 'source'], FORBID_ATTR: ['style', 'srcset'] })
  const document = new DOMParser().parseFromString(clean, 'text/html')
  for (const image of document.querySelectorAll('img')) if (!/^data:image\/(png|jpe?g);base64,/i.test(image.getAttribute('src') || '')) image.remove()
  for (const element of document.querySelectorAll('[src]')) if (element.localName !== 'img') element.removeAttribute('src')
  return document.body.innerHTML
}

function printable(value) {
  const normalized = String(value || '').replaceAll('–', '-').replaceAll('—', '-').replaceAll('’', "'").replaceAll('“', '"').replaceAll('”', '"')
  return normalized
}

function elementText(element) {
  return [...element.childNodes].map((child) => child.nodeType === 3 ? child.textContent : child.nodeName.toLowerCase() === 'br' ? '\n' : elementText(child) + (['p', 'div'].includes(child.nodeName.toLowerCase()) ? '\n' : '')).join('')
}

function elementFontSize(element, fallback) {
  const value = Number(element.getAttribute('data-font-size'))
  return Number.isFinite(value) && value > 0 ? Math.max(6, Math.min(72, value)) : fallback
}

function wrapText(text, font, size, maxWidth, unicodeFonts) {
  const lines = []
  for (const paragraph of printable(text).replace(/\r/g, '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      if (measureUnicodeText(word, font, size, unicodeFonts) > maxWidth) {
        if (line) { lines.push(line); line = '' }
        for (const character of word) {
          if (line && measureUnicodeText(line + character, font, size, unicodeFonts) > maxWidth) { lines.push(line); line = '' }
          line += character
        }
        continue
      }
      const candidate = line ? `${line} ${word}` : word
      if (line && measureUnicodeText(candidate, font, size, unicodeFonts) > maxWidth) { lines.push(line); line = word }
      else line = candidate
    }
    lines.push(line)
  }
  return lines
}

export async function richHtmlToPdf(markup, options = {}) {
  const { PDFDocument, PDFString, StandardFonts, rgb } = await getPdfLib()
  const source = sanitizeDocumentHtml(markup)
  const document = new DOMParser().parseFromString(source, 'text/html')
  const pdf = await PDFDocument.create()
  if (options.title) pdf.setTitle(String(options.title))
  const serif = options.fontFamily === 'serif'
  const regular = await pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica)
  const bold = await pdf.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique)
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const unicodeFonts = { ...await embedUnicodeFonts(pdf), baseBold: bold }
  const headingHex = /^#[0-9a-f]{6}$/i.test(options.headingColor || '') ? options.headingColor : '#171c29'
  const headingColor = rgb(parseInt(headingHex.slice(1, 3), 16) / 255, parseInt(headingHex.slice(3, 5), 16) / 255, parseInt(headingHex.slice(5, 7), 16) / 255)
  const landscape = options.orientation === 'landscape'
  const width = landscape ? (options.pageSize === 'Letter' ? 792 : 842) : (options.pageSize === 'Letter' ? 612 : 595)
  const height = landscape ? (options.pageSize === 'Letter' ? 612 : 595) : (options.pageSize === 'Letter' ? 792 : 842)
  const margin = Math.max(20, Math.min(100, Number(options.margin || 46)))
  const contentWidth = width - margin * 2
  let page = pdf.addPage([width, height])
  let cursor = height - margin

  const ensure = (needed) => {
    if (cursor - needed >= margin) return
    page = pdf.addPage([width, height])
    cursor = height - margin
  }
  const drawParagraph = (text, { size = Number(options.fontSize || 11), font = regular, indent = 0, before = 0, after = 9, color = rgb(.09, .11, .16), links = [], align = 'left' } = {}) => {
    const lines = wrapText(text, font, size, contentWidth - indent, unicodeFonts)
    const lineHeight = size * Math.max(1.1, Math.min(2, Number(options.lineHeight || 1.35)))
    const normalized = printable(text).replace(/\s+/g, ' ').trim()
    const linkRanges = links.map((link) => {
      const label = printable(link.text).replace(/\s+/g, ' ').trim()
      return { ...link, start: normalized.indexOf(label), length: label.length }
    }).filter((link) => link.start >= 0 && /^(https?:|mailto:|tel:)/i.test(link.href))
    let position = 0
    ensure(before + lineHeight)
    cursor -= before
    for (const line of lines) {
      ensure(lineHeight)
      const remaining = Math.max(0, contentWidth - indent - measureUnicodeText(line, font, size, unicodeFonts))
      const horizontal = margin + indent + (align === 'center' ? remaining / 2 : align === 'right' ? remaining : 0)
      if (line) drawUnicodeText(page, line, { x: horizontal, y: cursor, size, font, color }, unicodeFonts)
      const lineStart = Math.max(position, normalized.indexOf(line, position))
      for (const link of linkRanges) {
        const start = Math.max(lineStart, link.start)
        const end = Math.min(lineStart + line.length, link.start + link.length)
        if (end <= start) continue
        const left = horizontal + measureUnicodeText(line.slice(0, start - lineStart), font, size, unicodeFonts)
        const right = left + measureUnicodeText(line.slice(start - lineStart, end - lineStart), font, size, unicodeFonts)
        page.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [left, cursor - 2, right, cursor + size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.href) } })))
      }
      position = lineStart + line.length
      cursor -= lineHeight
    }
    cursor -= after
  }
  const drawTable = (table) => {
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table).map((row) => [...row.children].filter((cell) => ['td', 'th'].includes(cell.localName)).map((cell) => elementText(cell).trim()))
    if (!rows.length) return
    const columns = rows.reduce((count, row) => Math.max(count, row.length), 0)
    if (!columns) return
    const tableSize = Math.max(6, Math.min(14, Number(options.tableFontSize || 9)))
    const tableLineHeight = tableSize * 1.35
    const columnsPerBand = Math.max(1, Math.floor(contentWidth / Math.max(35, Math.min(120, Number(options.tableMinColumnWidth || 65)))))
    for (let bandStart = 0; bandStart < columns; bandStart += columnsPerBand) {
      const bandColumns = Math.min(columnsPerBand, columns - bandStart)
      const columnWidth = contentWidth / bandColumns
      if (columns > columnsPerBand) drawParagraph(`Columns ${bandStart + 1}-${bandStart + bandColumns}`, { size: tableSize, font: bold, before: 5, after: 7 })
      const wrapRow = (row, header) => Array.from({ length: bandColumns }, (_, index) => wrapText(row[bandStart + index] || '', header ? bold : regular, tableSize, columnWidth - 12, unicodeFonts))
      const headerLines = wrapRow(rows[0], true)
      const headerLineCount = Math.max(...headerLines.map((lines) => lines.length))
      const drawChunk = (cellLines, offset, count, header) => {
        const rowHeight = Math.max(tableLineHeight + 10, count * tableLineHeight + 10)
        for (let column = 0; column < bandColumns; column++) {
          const horizontal = margin + column * columnWidth
          page.drawRectangle({ x: horizontal, y: cursor - rowHeight, width: columnWidth, height: rowHeight, color: header ? rgb(.94, .95, .97) : rgb(1, 1, 1), borderColor: rgb(.76, .79, .84), borderWidth: .5 })
          cellLines[column].slice(offset, offset + count).forEach((line, lineIndex) => {
            if (line) drawUnicodeText(page, line, { x: horizontal + 6, y: cursor - tableSize - 5 - lineIndex * tableLineHeight, size: tableSize, font: header ? bold : regular, color: rgb(.1, .12, .16) }, unicodeFonts)
          })
        }
        cursor -= rowHeight
      }
      for (const [rowIndex, row] of rows.entries()) {
        const cellLines = rowIndex === 0 ? headerLines : wrapRow(row, false)
        const totalLines = Math.max(...cellLines.map((lines) => lines.length))
        let offset = 0
        while (offset < totalLines) {
          if (cursor - margin < tableLineHeight + 10) {
            page = pdf.addPage([width, height])
            cursor = height - margin
            if (rowIndex > 0 && headerLineCount <= 4) drawChunk(headerLines, 0, headerLineCount, true)
          }
          const availableLines = Math.max(1, Math.floor((cursor - margin - 10) / tableLineHeight))
          const count = Math.min(totalLines - offset, availableLines)
          drawChunk(cellLines, offset, count, rowIndex === 0)
          offset += count
          if (offset < totalLines) cursor = margin
        }
      }
      cursor -= 14
    }
  }
  const drawImage = async (imageNode) => {
    const sourceUrl = imageNode.getAttribute('src') || ''
    if (!/^data:image\/(png|jpe?g);base64,/i.test(sourceUrl)) return
    const bytes = new Uint8Array(await (await fetch(sourceUrl)).arrayBuffer())
    const image = /^data:image\/png/i.test(sourceUrl) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const requestedWidth = Number(imageNode.getAttribute('width')) || (Number(imageNode.getAttribute('height')) ? Number(imageNode.getAttribute('height')) / image.height * image.width : image.width)
    const requestedHeight = Number(imageNode.getAttribute('height')) || requestedWidth / image.width * image.height
    const scale = Math.min(contentWidth / requestedWidth, (height - margin * 2 - 14) / requestedHeight, 1)
    const imageWidth = requestedWidth * scale
    const imageHeight = requestedHeight * scale
    ensure(imageHeight + 14)
    page.drawImage(image, { x: margin, y: cursor - imageHeight, width: imageWidth, height: imageHeight })
    cursor -= imageHeight + 14
  }
  const drawElement = async (element) => {
    const tag = element.localName
    if (element.getAttribute('data-page-break') === 'before' && cursor < height - margin) { page = pdf.addPage([width, height]); cursor = height - margin }
    if (tag === 'table') { drawTable(element); return }
    if (tag === 'img') { await drawImage(element); return }
    if (tag === 'hr') { ensure(16); page.drawLine({ start: { x: margin, y: cursor }, end: { x: width - margin, y: cursor }, thickness: .7, color: rgb(.65, .68, .72) }); cursor -= 16; return }
    if (tag === 'ul' || tag === 'ol') {
      for (const [index, item] of [...element.children].entries()) {
        if (item.localName === 'li') drawParagraph(`${tag === 'ol' ? `${index + 1}.` : '•'} ${elementText(item).trim()}`, { indent: 14, after: 2 })
      }
      cursor -= 6
      return
    }
    if (tag === 'pre') { drawParagraph(element.textContent || '', { size: 9, font: mono, indent: 10, before: 5, after: 14 }); return }
    if (/^h[1-6]$/.test(tag)) {
      const sizes = { h1: 24, h2: 19, h3: 15, h4: 13, h5: 12, h6: 11 }
      drawParagraph(elementText(element), { size: elementFontSize(element, sizes[tag]), font: bold, before: 10, after: 6, color: headingColor, align: element.getAttribute('data-align') || 'left' })
      return
    }
    if (tag === 'p' || tag === 'blockquote') {
      if (elementText(element).trim()) drawParagraph(elementText(element), { size: elementFontSize(element, undefined), font: element.querySelector('strong,b') ? bold : element.querySelector('em,i') ? italic : regular, indent: tag === 'blockquote' ? 18 : 0, links: [...element.querySelectorAll('a[href]')].map((link) => ({ text: link.textContent, href: link.getAttribute('href') })), align: element.getAttribute('data-align') || 'left' })
      for (const image of element.querySelectorAll('img')) await drawImage(image)
      return
    }
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'body') {
      if (element.children.length) for (const child of element.children) await drawElement(child)
      else if (element.textContent?.trim()) drawParagraph(element.textContent)
      return
    }
    if (element.textContent?.trim()) drawParagraph(element.textContent)
  }

  for (const child of document.body.children) await drawElement(child)
  for (const [index, outputPage] of pdf.getPages().entries()) {
    const tokens = (value) => String(value || '').replaceAll('{page}', String(index + 1)).replaceAll('{total}', String(pdf.getPageCount()))
    if (options.header) drawUnicodeText(outputPage, tokens(options.header), { x: margin, y: height - 24, size: 9, font: regular, color: rgb(.35, .38, .43) }, unicodeFonts)
    if (options.footer) drawUnicodeText(outputPage, tokens(options.footer), { x: margin, y: 24, size: 9, font: regular, color: rgb(.35, .38, .43) }, unicodeFonts)
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}
