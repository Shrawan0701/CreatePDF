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
  const boldItalic = options.inlineFormatting ? await pdf.embedFont(serif ? StandardFonts.TimesRomanBoldItalic : StandardFonts.HelveticaBoldOblique) : bold
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const familyFonts = { [serif ? 'serif' : 'sans-serif']: { regular, bold, italic, boldItalic } }
  const otherFamily = serif ? 'sans-serif' : 'serif'
  if (options.inlineFormatting && document.querySelector(`[data-text-font="${otherFamily}"]`)) {
    const names = serif ? [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique] : [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic]
    const fonts = await Promise.all(names.map(name => pdf.embedFont(name)))
    familyFonts[otherFamily] = Object.fromEntries(['regular', 'bold', 'italic', 'boldItalic'].map((key, index) => [key, fonts[index]]))
  }
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
  // The writing editor exports individual inline runs so formatting one word
  // does not change the entire paragraph. Other converters retain their layout.
  const richLines = (element, { size, maxWidth, heading = false, prefix = '' }) => {
    const runs = []
    if (prefix) runs.push({ text: prefix, size })
    const collect = (node, inherited) => {
      if (node.nodeType === 3) { runs.push({ ...inherited, text: printable(node.textContent).replace(/\s+/g, ' ') }); return }
      if (node.localName === 'br') { runs.push({ ...inherited, text: '\n' }); return }
      if (['img', 'ul', 'ol', 'table'].includes(node.localName) || (options.markdown && ['pre', 'blockquote'].includes(node.localName))) return
      const style = { ...inherited,
        bold: inherited.bold || ['b', 'strong'].includes(node.localName),
        italic: inherited.italic || ['i', 'em'].includes(node.localName),
        underline: inherited.underline || node.localName === 'u',
        strike: inherited.strike || ['s', 'del', 'strike'].includes(node.localName),
        code: inherited.code || node.localName === 'code',
        href: node.localName === 'a' ? node.getAttribute('href') : inherited.href,
        family: ['serif', 'sans-serif'].includes(node.getAttribute('data-text-font')) ? node.getAttribute('data-text-font') : inherited.family,
        size: Number(node.getAttribute('data-text-size')) >= 6 && Number(node.getAttribute('data-text-size')) <= 72 ? Number(node.getAttribute('data-text-size')) : inherited.size,
      }
      for (const child of node.childNodes) collect(child, style)
    }
    for (const child of element.childNodes) collect(child, { bold: heading, size })
    const lines = []
    let line = []
    let lineWidth = 0
    const metrics = run => {
      const family = familyFonts[run.family] || { regular, bold, italic, boldItalic }
      const font = run.code ? mono : run.bold && run.italic ? family.boldItalic : run.bold ? family.bold : run.italic ? family.italic : family.regular
      return { font, fonts: { ...unicodeFonts, baseBold: family.bold } }
    }
    const flush = () => {
      while (line.at(-1)?.text === ' ') { lineWidth -= line.pop().width }
      const maxSize = Math.max(size, ...line.map(run => run.size))
      lines.push({ runs: line, width: lineWidth, size: maxSize, height: maxSize * Math.max(1.1, Math.min(2, Number(options.lineHeight || 1.35))) })
      line = []; lineWidth = 0
    }
    const add = (text, run) => {
      if (text === ' ' && !line.length) return
      const { font, fonts } = metrics(run)
      const width = measureUnicodeText(text, font, run.size, fonts)
      if (line.length && lineWidth + width > maxWidth) flush()
      if (text === ' ' && !line.length) return
      line.push({ ...run, text, font, fonts, width })
      lineWidth += width
    }
    for (const run of runs) {
      const { font, fonts } = metrics(run)
      for (const token of run.text.split(/(\n| +)/).filter(Boolean)) {
        if (token === '\n') { flush(); continue }
        const text = /^ +$/.test(token) ? ' ' : token
        if (measureUnicodeText(text, font, run.size, fonts) > maxWidth) for (const character of text) add(character, run)
        else add(text, run)
      }
    }
    if (line.length || !lines.length) flush()
    return lines
  }
  const drawRichLine = (line, horizontal, baseline, heading = false) => {
    for (const run of line.runs) {
      const link = /^(https?:|mailto:|tel:)/i.test(run.href || '')
      const color = link ? rgb(.08, .3, .65) : heading ? headingColor : rgb(.09, .11, .16)
      drawUnicodeText(page, run.text, { x: horizontal, y: baseline, size: run.size, font: run.font, color }, run.fonts)
      if (run.underline || link) page.drawLine({ start: { x: horizontal, y: baseline - 2 }, end: { x: horizontal + run.width, y: baseline - 2 }, thickness: .6, color })
      if (run.strike) page.drawLine({ start: { x: horizontal, y: baseline + run.size * .3 }, end: { x: horizontal + run.width, y: baseline + run.size * .3 }, thickness: .6, color })
      if (link) page.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [horizontal, baseline - 2, horizontal + run.width, baseline + run.size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(run.href) } })))
      horizontal += run.width
    }
  }
  const drawRichParagraph = (element, { size = Number(options.fontSize || 11), indent = 0, before = 0, after = 9, heading = false, prefix = '' } = {}) => {
    const maxWidth = contentWidth - indent
    const lines = richLines(element, { size, maxWidth, heading, prefix })
    const align = element.getAttribute('data-align') || 'left'
    ensure(before + lines[0].height)
    cursor -= before
    for (const line of lines) {
      ensure(line.height)
      const free = Math.max(0, maxWidth - line.width)
      const horizontal = margin + indent + (align === 'center' ? free / 2 : align === 'right' ? free : 0)
      drawRichLine(line, horizontal, cursor - line.size, heading)
      cursor -= line.height
    }
    cursor -= after
  }
  const drawRichTable = table => {
    const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table).map(row => [...row.children].filter(cell => ['td', 'th'].includes(cell.localName)))
    const columns = Math.max(0, ...rows.map(row => row.length))
    if (!columns) return
    const size = Number(options.fontSize || 12)
    const columnsPerBand = Math.max(1, Math.floor(contentWidth / 65))
    for (let start = 0; start < columns; start += columnsPerBand) {
      const count = Math.min(columnsPerBand, columns - start)
      const columnWidth = contentWidth / count
      const wrap = row => Array.from({ length: count }, (_, column) => richLines(row[start + column] || document.createElement('td'), { size, maxWidth: columnWidth - 12, heading: row[start + column]?.localName === 'th' }).map(line => ({ ...line, align: row[start + column]?.getAttribute('data-align') })))
      const headers = rows[0].some(cell => cell.localName === 'th') ? wrap(rows[0]) : null
      const maxHeight = cells => Math.max(size * 1.35, ...cells.flat().map(line => line.height))
      const paint = (cells, offset, lines, lineHeight, header) => {
        const rowHeight = lines * lineHeight + 10
        cells.forEach((cell, column) => {
          const x = margin + column * columnWidth
          page.drawRectangle({ x, y: cursor - rowHeight, width: columnWidth, height: rowHeight, color: header ? rgb(.94, .95, .97) : rgb(1, 1, 1), borderColor: rgb(.76, .79, .84), borderWidth: .5 })
          cell.slice(offset, offset + lines).forEach((line, index) => drawRichLine(line, x + 6 + Math.max(0, columnWidth - 12 - line.width) * (line.align === 'right' ? 1 : line.align === 'center' ? .5 : 0), cursor - 5 - line.size - index * lineHeight))
        })
        cursor -= rowHeight
      }
      for (const [index, row] of rows.entries()) {
        const cells = wrap(row)
        const lineHeight = maxHeight(cells)
        const length = Math.max(...cells.map(cell => cell.length))
        let offset = 0
        while (offset < length) {
          if (cursor - margin < lineHeight + 10) {
            page = pdf.addPage([width, height]); cursor = height - margin
            if (index > 0 && headers) {
              const headerLength = Math.max(...headers.map(cell => cell.length))
              const headerHeight = maxHeight(headers)
              if (headerLength * headerHeight + lineHeight + 20 <= height - margin * 2) paint(headers, 0, headerLength, headerHeight, true)
            }
          }
          const available = Math.max(1, Math.floor((cursor - margin - 10) / lineHeight))
          const lines = Math.min(length - offset, available)
          paint(cells, offset, lines, lineHeight, index === 0 && Boolean(headers))
          offset += lines
        }
      }
      cursor -= 14
    }
  }
  const drawTable = (table) => {
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table).map((row) => [...row.children].filter((cell) => ['td', 'th'].includes(cell.localName)).map((cell) => elementText(cell).trim()))
    if (!rows.length) return
    const columns = rows.reduce((count, row) => Math.max(count, row.length), 0)
    if (!columns) return
    const requestedTableSize = Math.max(6, Math.min(options.inlineFormatting ? 32 : 14, Number(options.tableFontSize || (options.inlineFormatting ? options.fontSize || 12 : 9))))
    const tableSize = options.tableFitWidth ? Math.max(6, requestedTableSize * Math.min(1, contentWidth / (columns * 65))) : requestedTableSize
    const tableLineHeight = tableSize * 1.35
    const columnsPerBand = options.tableFitWidth ? columns : Math.max(1, Math.floor(contentWidth / Math.max(35, Math.min(120, Number(options.tableMinColumnWidth || 65)))))
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
        // Move an ordinary row intact to the next page instead of leaving its
        // final wrapped line disconnected from the rest of its values.
        const rowHeight = totalLines * tableLineHeight + 10
        const repeatedHeaderHeight = rowIndex > 0 && headerLineCount <= 4 ? headerLineCount * tableLineHeight + 10 : 0
        if (options.tableFitWidth && rowHeight > cursor - margin && rowHeight <= height - margin * 2 - repeatedHeaderHeight) cursor = margin
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
    const percent = Number(imageNode.getAttribute('data-image-width'))
    const requestedWidth = percent > 0 ? contentWidth * Math.max(10, Math.min(100, percent)) / 100 : Number(imageNode.getAttribute('width')) || (Number(imageNode.getAttribute('height')) ? Number(imageNode.getAttribute('height')) / image.height * image.width : image.width)
    const requestedHeight = percent > 0 ? requestedWidth / image.width * image.height : Number(imageNode.getAttribute('height')) || requestedWidth / image.width * image.height
    const scale = Math.min(contentWidth / requestedWidth, (height - margin * 2 - 14) / requestedHeight, 1)
    const imageWidth = requestedWidth * scale
    const imageHeight = requestedHeight * scale
    ensure(imageHeight + 14)
    const align = imageNode.getAttribute('data-align') || imageNode.parentElement?.getAttribute('data-align')
    const x = margin + (align === 'center' ? (contentWidth - imageWidth) / 2 : align === 'right' ? contentWidth - imageWidth : 0)
    page.drawImage(image, { x, y: cursor - imageHeight, width: imageWidth, height: imageHeight })
    cursor -= imageHeight + 14
  }
  const drawCodeBlock = element => {
    const size = Math.max(6, Math.min(32, Number(options.codeFontSize || Number(options.fontSize || 12) * .85)))
    const lineHeight = size * 1.45
    const lines = []
    for (const sourceLine of (element.textContent || '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')) {
      let line = ''
      for (const character of sourceLine.replace(/\t/g, '  ')) {
        if (line && measureUnicodeText(line + character, mono, size, unicodeFonts) > contentWidth - 20) { lines.push(line); line = '' }
        line += character
      }
      lines.push(line)
    }
    ensure(lineHeight + 8)
    cursor -= 4
    for (const line of lines) {
      ensure(lineHeight)
      page.drawRectangle({ x: margin, y: cursor - lineHeight, width: contentWidth, height: lineHeight, color: rgb(.95, .96, .97) })
      if (line) drawUnicodeText(page, line, { x: margin + 10, y: cursor - size - 2, size, font: mono, color: rgb(.1, .13, .18) }, unicodeFonts)
      cursor -= lineHeight
    }
    cursor -= 12
  }
  const drawElement = async (element, listDepth = 0) => {
    const tag = element.localName
    if (element.getAttribute('data-page-break') === 'before' && cursor < height - margin) { page = pdf.addPage([width, height]); cursor = height - margin }
    if (tag === 'table') { if (options.inlineFormatting) drawRichTable(element); else drawTable(element); return }
    if (tag === 'img') { await drawImage(element); return }
    if (tag === 'hr') { ensure(16); page.drawLine({ start: { x: margin, y: cursor }, end: { x: width - margin, y: cursor }, thickness: .7, color: rgb(.65, .68, .72) }); cursor -= 16; return }
    if (tag === 'ul' || tag === 'ol') {
      for (const [index, item] of [...element.children].entries()) {
        if (item.localName === 'li') {
          if (options.inlineFormatting) {
            const prefix = `${tag === 'ol' ? `${index + (Number(element.getAttribute('start')) || 1)}.` : '•'} `
            const indent = 14 * (options.markdown ? listDepth + 1 : 1)
            const paragraphs = options.markdown ? [...item.children].filter(child => child.localName === 'p') : []
            if (paragraphs.length) paragraphs.forEach((paragraph, paragraphIndex) => drawRichParagraph(paragraph, { prefix: paragraphIndex === 0 ? prefix : '', indent, after: 4 }))
            else drawRichParagraph(item, { prefix, indent, after: 2 })
            for (const nested of item.children) {
              if (['ul', 'ol'].includes(nested.localName)) await drawElement(nested, listDepth + 1)
              else if (options.markdown && ['pre', 'table', 'blockquote'].includes(nested.localName)) await drawElement(nested, listDepth + 1)
            }
          } else drawParagraph(`${tag === 'ol' ? `${index + 1}.` : '•'} ${elementText(item).trim()}`, { indent: 14, after: 2 })
        }
      }
      cursor -= 6
      return
    }
    if (tag === 'pre') { if (options.markdown) drawCodeBlock(element); else drawParagraph(element.textContent || '', { size: 9, font: mono, indent: 10, before: 5, after: 14 }); return }
    if (/^h[1-6]$/.test(tag)) {
      const sizes = { h1: 24, h2: 19, h3: 15, h4: 13, h5: 12, h6: 11 }
      if (options.inlineFormatting) { drawRichParagraph(element, { size: sizes[tag] * Number(options.fontSize || 12) / 12, heading: true, before: 10, after: 6 }); return }
      drawParagraph(elementText(element), { size: elementFontSize(element, sizes[tag]), font: bold, before: 10, after: 6, color: headingColor, align: element.getAttribute('data-align') || 'left' })
      return
    }
    if (tag === 'p' || tag === 'blockquote') {
      if (options.markdown && tag === 'blockquote' && element.children.length) {
        for (const child of element.children) {
          if (['p', 'h1', 'h2', 'h3'].includes(child.localName)) drawRichParagraph(child, { indent: 18, heading: /^h/.test(child.localName), before: 3 })
          else await drawElement(child, listDepth)
        }
        return
      }
      if (options.inlineFormatting && (elementText(element).trim() || element.querySelector('br'))) drawRichParagraph(element, { size: elementFontSize(element, Number(options.fontSize || 11)), indent: tag === 'blockquote' ? 18 : 0 })
      else if (elementText(element).trim()) drawParagraph(elementText(element), { size: elementFontSize(element, undefined), font: element.querySelector('strong,b') ? bold : element.querySelector('em,i') ? italic : regular, indent: tag === 'blockquote' ? 18 : 0, links: [...element.querySelectorAll('a[href]')].map((link) => ({ text: link.textContent, href: link.getAttribute('href') })), align: element.getAttribute('data-align') || 'left' })
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
