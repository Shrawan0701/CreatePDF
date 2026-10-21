import 'regenerator-runtime/runtime.js'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import caveatUrl from '../assets/fonts/Caveat-Regular.ttf?url'
import kalamUrl from '../assets/fonts/Kalam-Regular.ttf?url'
import printUrl from '../assets/fonts/PatrickHand-Regular.ttf?url'
import { getPdfjsLib, loadPdfBytes } from './pdfEngine'

export const HANDWRITING_STYLES = {
  script: { label: 'Script', family: 'PdfHandCaveat', url: caveatUrl },
  natural: { label: 'Natural', family: 'PdfHandKalam', url: kalamUrl },
  print: { label: 'Print', family: 'PdfHandPatrick', url: printUrl },
}
export const HANDWRITING_PAPERS = { A4: [595.28, 841.89], Letter: [612, 792], A5: [419.53, 595.28] }
const paperColors = { ivory: '#fffef8', white: '#ffffff', cream: '#fff7e5' }
const check = signal => { if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const pdfColor = value => rgb(...[1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255))
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const graphemes = value => segmenter ? Array.from(segmenter.segment(value), item => item.segment) : Array.from(value)
let fontsPromise

export function handwritingDefaults() {
  return { style: 'script', ink: '#173f78', paper: 'ivory', rules: 'lined', size: 'A4', orientation: 'portrait', fontSize: 18, spacing: 1.7, margin: 20, marginLine: true, pageNumbers: false, keepPages: true, flow: 'paragraphs' }
}

export function loadHandwritingFonts() {
  if (!fontsPromise) fontsPromise = Promise.all(Object.entries(HANDWRITING_STYLES).map(async ([key, settings]) => {
    const response = await fetch(settings.url)
    if (!response.ok) throw new Error('Could not load the handwriting fonts. Refresh and try again.')
    const bytes = new Uint8Array(await response.arrayBuffer()), face = new FontFace(settings.family, bytes)
    await face.load(); document.fonts.add(face)
    return [key, { ...settings, bytes, font: fontkit.create(bytes) }]
  })).then(Object.fromEntries).catch(error => { fontsPromise = null; throw error })
  return fontsPromise
}

function extractedLines(content, viewport, pdfjs) {
  const items = content.items.filter(item => item.str?.trim()).map(item => {
    const transform = pdfjs.Util.transform(viewport.transform, item.transform)
    return { text: item.str, x: transform[4], y: transform[5], width: Math.abs(item.width || 0) * Math.hypot(viewport.transform[0], viewport.transform[1]), size: Math.max(1, Math.hypot(transform[2], transform[3])), rtl: item.dir === 'rtl' }
  }).sort((a, b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const item of items) {
    const last = rows.at(-1)
    if (last && Math.abs(last.y - item.y) <= Math.max(1.5, Math.min(last.size, item.size) * .3)) { last.items.push(item); last.size = Math.max(last.size, item.size) }
    else rows.push({ y: item.y, size: item.size, items: [item] })
  }
  let previous
  const output = []
  for (const row of rows) {
    const rtl = row.items.filter(item => item.rtl).length > row.items.length / 2
    row.items.sort((a, b) => rtl ? b.x - a.x : a.x - b.x)
    let text = '', last
    for (const item of row.items) {
      const gap = last ? rtl ? last.x - item.x - item.width : item.x - last.x - last.width : 0
      if (last && gap > Math.min(last.size, item.size) * .15 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += gap > item.size * 2 ? '    ' : ' '
      text += item.text; last = item
    }
    if (previous && (row.y - previous.y > Math.max(row.size, previous.size) * 1.8 || row.size > previous.size * 1.25 || previous.size > row.size * 1.25)) output.push('')
    output.push(text.trim()); previous = row
  }
  return output.join('\n')
}

export async function readHandwritingSource(file, { signal, onProgress } = {}) {
  const pdfjs = await getPdfjsLib(), data = await loadPdfBytes(file)
  check(signal)
  const task = pdfjs.getDocument({ data })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const pdf = await task.promise, pages = []
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal)
      onProgress?.(Math.round((number - 1) / pdf.numPages * 100), `Reading page ${number} of ${pdf.numPages}…`)
      const page = await pdf.getPage(number)
      try { pages.push({ number, text: extractedLines(await page.getTextContent(), page.getViewport({ scale: 1 }), pdfjs) }) }
      finally { page.cleanup() }
      await tick()
    }
    check(signal); onProgress?.(100, 'Text ready')
    return { file, pages, pageCount: pdf.numPages }
  } finally { signal?.removeEventListener('abort', abort); await task.destroy().catch(() => {}) }
}

export function handwritingSourcePages(range, total) {
  if (!range.trim() || range.trim().toLowerCase() === 'all') return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set()
  for (const part of range.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use source pages such as 1-3, 5.')
    const start = Number(match[1]), end = Number(match[2] || match[1])
    if (start < 1 || end < start || end > total) throw new Error(`Source pages must be between 1 and ${total}.`)
    for (let number = start; number <= end; number++) pages.add(number)
  }
  return [...pages].sort((a, b) => a - b)
}

export function handwritingFlow(text, flow) {
  const clean = String(text).normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').replace(/\t/g, '    ').trim()
  if (flow === 'lines') return clean
  return clean.split(/\n\s*\n/).map(paragraph => paragraph.split('\n').reduce((result, line) => {
    const current = line.trim()
    if (!result) return current
    if (/^(?:[•●▪*-]|\d+[.)])\s/.test(current) || /^(?:[•●▪*-]|\d+[.)])\s/.test(result.split('\n').at(-1))) return `${result}\n${current}`
    return /[a-z]-$/i.test(result) && /^[a-z]/.test(current) ? result.slice(0, -1) + current : `${result} ${current}`
  }, '')).join('\n\n')
}

export function buildTextHandwritingPlan(text, options, fonts) {
  // Form feeds are explicit page breaks; wrapping and automatic overflow use
  // the same measured layout for the on-screen pages and the exported PDF.
  const pages = String(text).replace(/\r\n?/g, '\n').split('\f').map((content, index) => ({ number: index + 1, text: content }))
  const plan = buildHandwritingPlan({ pages }, pages.map(page => page.number), {}, { ...options, keepPages: true }, fonts)
  return { ...plan, pages: plan.pages.map(page => ({ ...page, sourcePage: null })) }
}

export function buildHandwritingPlan(source, selection, edits, options, fonts) {
  if (!selection.length) throw new Error('Choose source pages.')
  if (!HANDWRITING_STYLES[options.style]) throw new Error('Choose a writing style.')
  const fontSize = Number(options.fontSize), spacing = Number(options.spacing), marginMm = Number(options.margin)
  if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 30) throw new Error('Set text size between 10 and 30 pt.')
  if (!Number.isFinite(spacing) || spacing < 1.2 || spacing > 2.4) throw new Error('Set line spacing between 1.2 and 2.4.')
  if (!Number.isFinite(marginMm) || marginMm < 10 || marginMm > 35) throw new Error('Set margins between 10 and 35 mm.')
  let [width, height] = HANDWRITING_PAPERS[options.size] || HANDWRITING_PAPERS.A4
  if (options.orientation === 'landscape') [width, height] = [height, width]
  const margin = marginMm * 72 / 25.4, writingWidth = width - margin * 2, lineHeight = fontSize * spacing
  const firstBaseline = margin + fontSize * 1.1, lastBaseline = height - margin - fontSize * .3
  const linesPerPage = Math.floor((lastBaseline - firstBaseline) / lineHeight) + 1
  if (writingWidth < fontSize * 3 || linesPerPage < 1) throw new Error('Reduce margins or text size for this paper.')
  const measureCanvas = document.createElement('canvas'), context = measureCanvas.getContext('2d')
  context.font = `${fontSize}px "${fonts[options.style].family}", "PdfHandKalam", sans-serif`; context.fontKerning = 'none'
  const measures = new Map(), preferred = [...new Set([options.style, 'natural', 'script', 'print'])]
  const measure = text => {
    if (measures.has(text)) return measures.get(text)
    const runs = []; let raster = false
    for (const character of graphemes(text)) {
      const key = preferred.find(value => Array.from(character).every(point => /[\u200c\u200d\ufe0f]/.test(point) || fonts[value].font.hasGlyphForCodePoint(point.codePointAt(0))))
      if (!key) { raster = true; break }
      if (runs.at(-1)?.key === key) runs.at(-1).text += character
      else runs.push({ key, text: character })
    }
    let textWidth = 0
    if (!raster) for (const run of runs) {
      const face = fonts[run.key].font
      const shaped = face.layout(run.text)
      // PDF text drawing does not position individual combining marks. Preserve
      // browser shaping for lines that need explicit glyph offsets.
      if (shaped.positions?.some(position => Math.abs(position.xOffset || 0) > .01 || Math.abs(position.yOffset || 0) > .01)) { raster = true; break }
      run.width = shaped.glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / face.unitsPerEm * fontSize
      textWidth += run.width
    }
    if (raster) textWidth = context.measureText(text).width
    const measured = { text, runs, raster, width: textWidth }; measures.set(text, measured); return measured
  }
  const texts = selection.map(number => ({ number, text: handwritingFlow(edits[number] ?? source.pages[number - 1].text, options.flow) }))
  if (!texts.some(entry => entry.text.trim())) throw new Error('No text to convert. Edit the text or read scanned pages.')
  const groups = options.keepPages ? texts : [{ number: null, text: texts.map(entry => entry.text).join('\n\n') }]
  const pages = []
  for (const group of groups) {
    const lines = []
    for (const paragraph of group.text.split('\n')) {
      if (!paragraph.trim()) { lines.push(measure('')); continue }
      let line = ''
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (measure(candidate).width <= writingWidth) { line = candidate; continue }
        if (line) { lines.push(measure(line)); line = '' }
        if (measure(word).width <= writingWidth) { line = word; continue }
        for (const character of graphemes(word)) {
          if (line && measure(line + character).width > writingWidth) { lines.push(measure(line)); line = '' }
          line += character
        }
      }
      lines.push(measure(line))
    }
    while (lines.length > 1 && !lines.at(-1).text) lines.pop()
    for (let offset = 0; offset < Math.max(1, lines.length); offset += linesPerPage) pages.push({ sourcePage: group.number, lines: lines.slice(offset, offset + linesPerPage).map((line, index) => ({ ...line, x: margin, baseline: firstBaseline + index * lineHeight })) })
  }
  const segments = []
  const ruleColor = options.rules === 'gray' ? '#d5d5d5' : options.rules === 'grid' ? '#d1dbea' : '#bbcee9'
  if (options.rules !== 'plain') {
    for (let y = firstBaseline + 3; y <= height - margin; y += lineHeight) segments.push({ x1: margin - 8, y1: y, x2: width - margin + 8, y2: y, color: ruleColor, thickness: .45 })
    if (options.rules === 'grid') for (let x = margin - 8; x <= width - margin + 8; x += lineHeight) segments.push({ x1: x, y1: margin, x2: x, y2: height - margin, color: ruleColor, thickness: .35 })
    if (options.marginLine) segments.push({ x1: margin - 12, y1: 0, x2: margin - 12, y2: height, color: '#e8aeae', thickness: .6 })
  }
  measureCanvas.width = measureCanvas.height = 0
  return { width, height, margin, fontSize, fonts, options, pages, segments, background: paperColors[options.paper] || paperColors.ivory, ink: options.ink, sourcePages: selection.length, rasterLines: pages.reduce((sum, page) => sum + page.lines.filter(line => line.raster).length, 0) }
}

export function drawHandwritingPreview(canvas, plan, index, scale = 1.5) {
  canvas.width = Math.ceil(plan.width * scale); canvas.height = Math.ceil(plan.height * scale)
  const context = canvas.getContext('2d'); context.scale(scale, scale)
  context.fillStyle = plan.background; context.fillRect(0, 0, plan.width, plan.height)
  for (const line of plan.segments) { context.strokeStyle = line.color; context.lineWidth = line.thickness; context.beginPath(); context.moveTo(line.x1, line.y1); context.lineTo(line.x2, line.y2); context.stroke() }
  context.fillStyle = plan.ink; context.textBaseline = 'alphabetic'; context.fontKerning = 'none'
  for (const line of plan.pages[index].lines) {
    let x = line.x
    if (line.raster) { context.font = `${plan.fontSize}px "${plan.fonts[plan.options.style].family}", "PdfHandKalam", sans-serif`; context.fillText(line.text, x, line.baseline) }
    else for (const run of line.runs) { context.font = `${plan.fontSize}px "${plan.fonts[run.key].family}"`; context.fillText(run.text, x, line.baseline); x += run.width }
  }
  if (plan.options.pageNumbers) { context.font = '9px Arial, sans-serif'; context.fillStyle = '#777777'; context.textAlign = 'center'; context.fillText(String(index + 1), plan.width / 2, plan.height - plan.margin / 2) }
}

export async function createHandwritingPdf(plan, { signal, title = 'Handwritten notes', onProgress } = {}) {
  check(signal)
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); pdf.setTitle(title); pdf.setCreator('CreatePDF.si')
  const embedded = new Map(), pageNumberFont = plan.options.pageNumbers ? await pdf.embedFont(StandardFonts.Helvetica) : null
  for (let index = 0; index < plan.pages.length; index++) {
    check(signal); onProgress?.(Math.round(index / plan.pages.length * 95), `Creating page ${index + 1} of ${plan.pages.length}…`); await tick()
    const page = pdf.addPage([plan.width, plan.height])
    page.drawRectangle({ x: 0, y: 0, width: plan.width, height: plan.height, color: pdfColor(plan.background) })
    for (const rule of plan.segments) page.drawLine({ start: { x: rule.x1, y: plan.height - rule.y1 }, end: { x: rule.x2, y: plan.height - rule.y2 }, thickness: rule.thickness, color: pdfColor(rule.color) })
    for (const line of plan.pages[index].lines) {
      check(signal)
      if (!line.text) continue
      let x = line.x
      if (line.raster) {
        // Complex or unsupported scripts use browser shaping for this line only. The rest
        // of the document retains embedded, selectable handwriting text.
        const canvas = document.createElement('canvas'), density = 3
        const padding = plan.fontSize * .5
        canvas.width = Math.ceil((line.width + padding * 2) * density); canvas.height = Math.ceil(plan.fontSize * 2.5 * density)
        try {
          const context = canvas.getContext('2d'); context.scale(density, density)
          context.font = `${plan.fontSize}px "${plan.fonts[plan.options.style].family}", "PdfHandKalam", sans-serif`; context.fontKerning = 'none'; context.fillStyle = plan.ink
          const baseline = plan.fontSize * 1.7; context.fillText(line.text, padding, baseline)
          const image = await pdf.embedPng(canvas.toDataURL('image/png'))
          page.drawImage(image, { x: x - padding, y: plan.height - line.baseline - (canvas.height / density - baseline), width: canvas.width / density, height: canvas.height / density })
        } finally { canvas.width = canvas.height = 0 }
      } else for (const run of line.runs) {
        if (!embedded.has(run.key)) embedded.set(run.key, await pdf.embedFont(plan.fonts[run.key].bytes, { subset: true }))
        page.drawText(run.text, { x, y: plan.height - line.baseline, size: plan.fontSize, font: embedded.get(run.key), color: pdfColor(plan.ink) }); x += run.width
      }
    }
    if (pageNumberFont) {
      const label = String(index + 1), size = 9
      page.drawText(label, { x: (plan.width - pageNumberFont.widthOfTextAtSize(label, size)) / 2, y: plan.margin / 2, size, font: pageNumberFont, color: rgb(.47, .47, .47) })
    }
  }
  check(signal); onProgress?.(97, 'Finishing PDF…'); await tick()
  const bytes = await pdf.save({ useObjectStreams: true })
  check(signal); onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
