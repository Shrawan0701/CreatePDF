import { Document, ExternalHyperlink, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { getPdfjsLib, loadPdfBytes, renderPageToCanvas } from './pdfEngine'
import { detectBorderlessWordTables, detectWordTables, groupWordLines, wordLinkRectangle, wordPageSelection } from './pdfWordLayout'

const twips = value => Math.round(value * 20)
const emu = value => Math.round(value * 12700)
const identity = [1, 0, 0, 1, 0, 0]
const cleanText = value => [...value].filter(character => character.codePointAt(0) >= 32 || [9, 10, 13].includes(character.codePointAt(0))).join('')

function collectGraphics(operators, pdfjs, viewport) {
  const segments = [], images = [], fills = []
  const stack = []
  let state = { matrix: identity, fill: '000000' }
  const point = (x, y) => {
    const coordinate = [x, y]
    pdfjs.Util.applyTransform(coordinate, state.matrix)
    pdfjs.Util.applyTransform(coordinate, viewport.transform)
    return coordinate
  }
  const edge = (a, b) => { const [x1, y1] = point(...a), [x2, y2] = point(...b); segments.push({ x1, y1, x2, y2 }) }
  for (let index = 0; index < operators.fnArray.length; index++) {
    const op = operators.fnArray[index], args = operators.argsArray[index]
    if (op === pdfjs.OPS.save || op === pdfjs.OPS.paintFormXObjectBegin) {
      stack.push(state); state = { ...state }
      if (op === pdfjs.OPS.paintFormXObjectBegin && args[0]) state.matrix = pdfjs.Util.transform(state.matrix, args[0])
    } else if (op === pdfjs.OPS.restore || op === pdfjs.OPS.paintFormXObjectEnd) state = stack.pop() || { matrix: identity, fill: '000000' }
    else if (op === pdfjs.OPS.transform) state = { ...state, matrix: pdfjs.Util.transform(state.matrix, args) }
    else if (op === pdfjs.OPS.setFillRGBColor) state.fill = typeof args[0] === 'string' ? args[0].replace('#', '') : [...args].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')
    else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op)) {
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(p => point(...p))
      const x = Math.min(...corners.map(p => p[0])), y = Math.min(...corners.map(p => p[1]))
      images.push({ x, y, width: Math.max(...corners.map(p => p[0])) - x, height: Math.max(...corners.map(p => p[1])) - y })
    } else if (op === pdfjs.OPS.constructPath) {
      const path = args[1]?.[0]
      if (!ArrayBuffer.isView(path) && !Array.isArray(path)) continue
      let current = [0, 0], start = current
      const stroke = [pdfjs.OPS.stroke, pdfjs.OPS.closeStroke, pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke, pdfjs.OPS.closeFillStroke, pdfjs.OPS.closeEOFillStroke].includes(args[0])
      const box = args[2]
      const filled = [pdfjs.OPS.fill, pdfjs.OPS.eoFill, pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke, pdfjs.OPS.closeFillStroke, pdfjs.OPS.closeEOFillStroke].includes(args[0])
      if (filled && box) {
        const a = point(box[0], box[1]), b = point(box[2], box[3])
        fills.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), color: state.fill })
      }
      for (let cursor = 0; cursor < path.length;) {
        const command = path[cursor++]
        if (command === 0) { current = [path[cursor++], path[cursor++]]; start = current }
        else if (command === 1) { const next = [path[cursor++], path[cursor++]]; if (stroke) edge(current, next); current = next }
        else if (command === 4) { if (stroke) edge(current, start); current = start }
        else if (command === 2) { cursor += 4; current = [path[cursor++], path[cursor++]] }
        else if (command === 3) { cursor += 2; current = [path[cursor++], path[cursor++]] }
        else break
      }
    }
  }
  return { segments, images, fills }
}

function fontInfo(page, fontName, fallback) {
  let font
  try { font = page.commonObjs.get(fontName) } catch { /* PDF font not available. */ }
  const name = (font?.name || '').replace(/^[A-Z]{6}\+/, '')
  const family = /times/i.test(name) ? 'Times New Roman' : /helvetica|arial/i.test(name) ? 'Arial' : /courier|mono/i.test(name || fallback) ? 'Courier New' : /calibri/i.test(name) ? 'Calibri' : /cambria/i.test(name) ? 'Cambria' : /serif/i.test(fallback) && !/sans/i.test(fallback) ? 'Times New Roman' : 'Arial'
  return { font: family, bold: Boolean(font?.bold || /bold|black|heavy/i.test(name)), italics: Boolean(font?.italic || /italic|oblique/i.test(name)) }
}

function runs(items, left, links, absoluteGaps = true) {
  const result = [], stops = []
  let previous
  for (const item of items) {
    const gap = previous ? item.x - previous.x - previous.width : 0
    if (previous && gap > Math.max(2, item.size * .35)) {
      if (absoluteGaps) { stops.push({ type: 'left', position: twips(item.x - left) }); result.push(new TextRun({ text: '\t', font: item.font, size: Math.round(item.size * 2) })) }
      else result.push(new TextRun({ text: ' ', font: item.font, size: Math.round(item.size * 2) }))
    } else if (previous && gap > Math.max(.5, item.size * .12) && !/\s$/.test(previous.text) && !/^\s/.test(item.text)) {
      result.push(new TextRun({ text: ' ', font: item.font, size: Math.round(item.size * 2) }))
    }
    const text = new TextRun({ text: cleanText(item.text), font: item.font, size: Math.max(2, Math.round(item.size * 2)), bold: item.bold, italics: item.italics })
    const link = links.find(link => item.x + item.width / 2 >= link.x && item.x + item.width / 2 <= link.x + link.width && item.y >= link.y && item.y <= link.y + link.height + 2)
    result.push(link ? new ExternalHyperlink({ link: link.url, children: [text] }) : text)
    previous = item
  }
  return { children: result, tabStops: stops }
}

function wordTable(table, links, fills) {
  const widths = table.xs.slice(1).map((right, index) => twips(right - table.xs[index]))
  const border = { style: table.ruled ? 'single' : 'nil', size: 4, color: 'A0A0A0' }
  return new Table({ width: { size: twips(table.width), type: 'dxa' }, columnWidths: widths, layout: 'fixed',
    float: { horizontalAnchor: 'page', verticalAnchor: 'page', absoluteHorizontalPosition: twips(table.x), absoluteVerticalPosition: twips(table.y), overlap: 'overlap', leftFromText: 0, rightFromText: 0, topFromText: 0, bottomFromText: 0 },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: table.rows.map((cells, row) => new TableRow({ cantSplit: true, tableHeader: row === 0, height: { value: twips(table.ys[row + 1] - table.ys[row]), rule: 'atLeast' }, children: cells.map((items, column) => {
      const fill = fills.find(fill => fill.x <= table.xs[column] + 2 && fill.x + fill.width >= table.xs[column + 1] - 2 && fill.y <= table.ys[row] + 2 && fill.y + fill.height >= table.ys[row + 1] - 2)
      return new TableCell({ width: { size: widths[column], type: 'dxa' }, margins: { top: 30, bottom: 30, left: 60, right: 60 }, verticalAlign: 'top', shading: fill ? { fill: fill.color } : undefined,
        children: items.length ? groupWordLines(items).map(line => new Paragraph({ ...runs(line.items, line.items[0].x, links, false), spacing: { before: 0, after: 0, line: twips(line.size * 1.05), lineRule: 'atLeast' } })) : [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '', size: 2 })] })] })
    }) })) })
}

function pagePicture(data, box, behindDocument = false) {
  return new ImageRun({ type: 'png', data, transformation: { width: box.width * 96 / 72, height: box.height * 96 / 72 }, floating: {
    horizontalPosition: { relative: 'page', offset: emu(box.x) }, verticalPosition: { relative: 'page', offset: emu(box.y) }, allowOverlap: true, lockAnchor: true, behindDocument, wrap: { type: 0 },
  } })
}

function pngBytes(canvas) { return Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0)) }

async function renderWordGraphics(page, pdfjs, tables, includeImages) {
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  const textOperations = new Set(['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].map(name => pdfjs.OPS[name]).filter(Number.isFinite))
  const imageOperations = new Set(Object.entries(pdfjs.OPS).filter(([name]) => /^paint.*Image|^paintJpeg/.test(name)).map(([, operation]) => operation))
  await page.render({ canvasContext: context, viewport, background: 'rgba(0,0,0,0)', operationsFilter: (index, operators) => {
    const operation = operators.fnArray[index]
    return !textOperations.has(operation) && (includeImages || !imageOperations.has(operation))
  } }).promise
  // Real Word tables supply their own borders, shading and editable cells.
  // Everything outside them keeps its original PDF drawing, including thin
  // filled rules, curves, stamps, vector signatures, and clipping/masks.
  for (const table of tables) context.clearRect((table.x - 1) * 2, (table.y - 1) * 2, (table.width + 2) * 2, (table.height + 2) * 2)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let visible = false
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) { visible = true; break }
  const data = visible ? pngBytes(canvas) : null
  canvas.width = canvas.height = 0
  return data
}

export async function pdfToWord(file, options = {}, progress = () => {}) {
  const pdfjs = await getPdfjsLib()
  const task = pdfjs.getDocument({ data: await loadPdfBytes(file), fontExtraProperties: true })
  try {
    const pdf = await task.promise
    const selected = wordPageSelection(options.pageRange || '', pdf.numPages)
    const sections = []
    let tablesCount = 0, imagesCount = 0, scannedPages = 0
    for (const [index, number] of selected.entries()) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const operators = await page.getOperatorList()
      const graphics = collectGraphics(operators, pdfjs, viewport)
      const items = content.items.filter(item => item.str?.trim()).map(item => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const size = Math.max(1, Math.hypot(transform[2], transform[3]))
        const style = content.styles[item.fontName]
        return { text: item.str, x: transform[4], y: transform[5], width: item.width, size, ascent: style?.ascent || .8, ...fontInfo(page, item.fontName, style?.fontFamily) }
      })
      const links = (await page.getAnnotations()).filter(annotation => annotation.subtype === 'Link' && /^(https?:|mailto:|tel:)/i.test(annotation.url || '')).map(annotation => {
        const rectangle = wordLinkRectangle(annotation.rect, viewport.transform)
        return rectangle ? { url: annotation.url, ...rectangle } : null
      }).filter(Boolean)
      const children = [new Paragraph({ spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, children: [new TextRun({ text: '', size: 2 })] })]
      if (options.mode === 'appearance' || !items.length) {
        if (!items.length) scannedPages++
        const canvas = await renderPageToCanvas(pdf, number, 1.7)
        children[0].addChildElement(pagePicture(pngBytes(canvas), { x: 0, y: 0, width: viewport.width, height: viewport.height }))
        canvas.width = canvas.height = 0
      } else {
        const ruled = options.detectTables === false ? [] : detectWordTables(items, graphics.segments)
        const used = new Set(ruled.flatMap(table => table.items))
        const tables = [...ruled, ...(options.detectTables === false ? [] : detectBorderlessWordTables(items, used))]
        for (const table of tables) for (const item of table.items) used.add(item)
        tablesCount += tables.length
        const blocks = tables.map(table => ({ y: table.y, x: table.x, element: wordTable(table, links, graphics.fills) }))
        for (const line of groupWordLines(items.filter(item => !used.has(item)))) {
          const left = line.items[0].x
          const top = Math.max(0, Math.min(...line.items.map(item => item.y - item.size * item.ascent)))
          const height = Math.max(...line.items.map(item => item.size)) * 1.3
          blocks.push({ x: left, y: top, element: new Paragraph({ ...runs(line.items, left, links), spacing: { before: 0, after: 0, line: twips(height), lineRule: 'atLeast' },
            frame: { type: 'absolute', position: { x: twips(left), y: twips(top) }, width: twips(Math.max(10, viewport.width - left - 5)), height: twips(height), anchor: { horizontal: 'page', vertical: 'page' }, wrap: 'none', rule: 'atLeast' },
          }) })
        }
        children.push(...blocks.sort((a, b) => a.y - b.y || a.x - b.x).map(block => block.element))
        const drawings = await renderWordGraphics(page, pdfjs, tables, options.includeImages !== false)
        if (drawings) children[0].addChildElement(pagePicture(drawings, { x: 0, y: 0, width: viewport.width, height: viewport.height }, true))
        if (options.includeImages !== false) imagesCount += graphics.images.length
      }
      // Section breaks must live in normal flow, never inside an absolutely
      // positioned paragraph; Word processors otherwise move its frames to
      // the following page and apply that page's dimensions to the table.
      children.push(new Paragraph({ spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, children: [new TextRun({ text: '', size: 2 })] }))
      const landscape = viewport.width > viewport.height
      sections.push({ properties: { type: 'nextPage', page: { size: { width: twips(landscape ? viewport.height : viewport.width), height: twips(landscape ? viewport.width : viewport.height), orientation: landscape ? 'landscape' : 'portrait' }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } }, children })
      progress(Math.round((index + 1) / selected.length * 90))
    }
    const output = new Document({ title: file.name.replace(/\.pdf$/i, ''), styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { before: 0, after: 0 } } } } }, sections })
    const blob = await Packer.toBlob(output)
    progress(100)
    return { blob, pages: selected.length, tables: tablesCount, images: imagesCount, scannedPages }
  } finally { await task.destroy() }
}
