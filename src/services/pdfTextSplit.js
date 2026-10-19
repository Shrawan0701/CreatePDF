import { getPdfjsLib } from './pdfEngine'

const check = signal => { if (signal?.aborted) throw new DOMException('Text search cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const normalize = value => String(value).normalize('NFKC').replace(/\u00ad/g, '').replace(/[\s\u200b\ufeff]+/gu, ' ').trim()
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function textSplitDefaults() {
  return { markers: '', matchMode: 'contains', caseSensitive: false, markerLogic: 'any', region: 'anywhere', regionSize: 25, boundary: 'before', collapseConsecutive: false }
}

export function compileTextSplitSearch(options) {
  const { markers = '', matchMode = 'contains', caseSensitive = false, markerLogic = 'any', region = 'anywhere', regionSize = 25 } = options
  if (!['contains', 'words', 'line'].includes(matchMode)) throw new Error('Choose a valid text matching method.')
  if (!['any', 'all'].includes(markerLogic)) throw new Error('Choose how to match multiple markers.')
  if (!['anywhere', 'header', 'footer'].includes(region)) throw new Error('Choose which part of the page to search.')
  if (region !== 'anywhere' && (!Number.isFinite(Number(regionSize)) || Number(regionSize) < 5 || Number(regionSize) > 50)) throw new Error('Set the header or footer height between 5% and 50%.')
  const seen = new Set(), terms = []
  for (const row of markers.split(/\r?\n/)) {
    const term = normalize(row)
    if (!term) continue
    const key = caseSensitive ? term : term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key); terms.push(term)
  }
  if (!terms.length) throw new Error('Enter text that identifies the start or end of a section.')
  if (terms.length > 50 || terms.some(term => term.length > 500)) throw new Error('Use up to 50 markers, with no more than 500 characters per marker.')
  return { ...textSplitDefaults(), ...options, regionSize: Number(regionSize), terms, expressions: terms.map(term => new RegExp(matchMode === 'line' ? `^(?:${literal(term)})$` : literal(term), caseSensitive ? 'gu' : 'giu')) }
}

function textLines(content, viewport, pdfjs) {
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const matrix = pdfjs.Util.transform(viewport.transform, item.transform)
    return { text: item.str, x: matrix[4], y: matrix[5], width: Math.abs(item.width || 0) * (viewport.scale || 1), size: Math.max(1, Math.hypot(matrix[2], matrix[3])), rtl: item.dir === 'rtl' }
  }).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  for (const item of items) {
    const last = lines.at(-1)
    if (last && Math.abs(last.y - item.y) <= Math.max(2, Math.min(last.size, item.size) * .3)) last.items.push(item)
    else lines.push({ y: item.y, size: item.size, items: [item] })
  }
  return lines.map(line => {
    const rtl = line.items.filter(item => item.rtl).length > line.items.length / 2
    line.items.sort((a, b) => rtl ? b.x - a.x : a.x - b.x)
    let text = '', previous
    for (const item of line.items) {
      const gap = previous ? rtl ? previous.x - item.x - item.width : item.x - previous.x - previous.width : 0
      if (previous && gap > Math.min(previous.size, item.size) * .12 && !/\s$/u.test(text) && !/^\s/u.test(item.text)) text += ' '
      text += item.text; previous = item
    }
    return { text: normalize(text), y: Math.min(1, Math.max(0, line.y / viewport.height)) }
  }).filter(line => line.text)
}

// Cache searchable text once. Changing markers, case, or search region can
// then search the cached index without decoding the entire PDF again.
export async function indexTextSplitSource(source, { signal, onProgress = () => {} } = {}) {
  check(signal)
  if (!source?.bytes) throw new Error('Choose a PDF first.')
  const pdfjs = await getPdfjsLib()
  check(signal)
  const task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false, disableFontFace: true })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const pages = []
  try {
    const pdf = await task.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal)
      onProgress(Math.round((number - 1) / pdf.numPages * 98), `Reading text on page ${number} of ${pdf.numPages}`)
      let page
      try {
        page = await pdf.getPage(number)
        const content = await page.getTextContent()
        check(signal)
        pages.push({ number, lines: textLines(content, page.getViewport({ scale: 1 }), pdfjs), error: false })
      } catch (error) { check(signal); pages.push({ number, lines: [], error: true }) }
      finally { page?.cleanup() }
      await tick()
    }
    check(signal); onProgress(100, 'Text ready for searching')
    return { pageCount: pdf.numPages, pages, textlessPages: pages.filter(page => !page.lines.length && !page.error).map(page => page.number), failedPages: pages.filter(page => page.error).map(page => page.number) }
  } finally { signal?.removeEventListener('abort', abort); await task.destroy().catch(() => {}) }
}

function firstHit(text, expression, wholeWords) {
  expression.lastIndex = 0
  let match
  while ((match = expression.exec(text))) {
    const end = match.index + match[0].length
    if (!wholeWords || !(/[\p{L}\p{N}\p{M}_]$/u.test(text.slice(Math.max(0, match.index - 2), match.index)) || /^[\p{L}\p{N}\p{M}_]/u.test(text.slice(end, end + 2)))) return { index: match.index, value: match[0] }
  }
  return null
}

export async function findTextSplitMatches(index, options, { signal, onProgress = () => {} } = {}) {
  const compiled = compileTextSplitSearch(options)
  const matches = []
  for (const [position, page] of index.pages.entries()) {
    check(signal)
    const lines = page.lines.filter(line => compiled.region === 'anywhere' || compiled.region === 'header' && line.y <= Number(compiled.regionSize) / 100 || compiled.region === 'footer' && line.y >= 1 - Number(compiled.regionSize) / 100)
    const text = lines.map(line => line.text).join(' '), hits = []
    for (const [termIndex, term] of compiled.terms.entries()) {
      let hit, searched = text
      if (compiled.matchMode === 'line') {
        for (const line of lines) {
          hit = firstHit(line.text, compiled.expressions[termIndex], false)
          if (hit) { searched = line.text; break }
        }
      } else hit = firstHit(text, compiled.expressions[termIndex], compiled.matchMode === 'words')
      if (!hit) continue
      const start = Math.max(0, hit.index - 65), end = Math.min(searched.length, hit.index + hit.value.length + 100)
      hits.push({ term, before: `${start ? '…' : ''}${searched.slice(start, hit.index)}`, matched: hit.value, after: `${searched.slice(hit.index + hit.value.length, end)}${end < searched.length ? '…' : ''}` })
    }
    if (hits.length && (compiled.markerLogic !== 'all' || hits.length === compiled.terms.length)) matches.push({ page: page.number, hits })
    if (position % 20 === 0) { onProgress(Math.round((position + 1) / index.pages.length * 100), `Searching page ${page.number} of ${index.pageCount}`); await tick() }
  }
  check(signal); onProgress(100, `${matches.length} matching pages found`)
  return { matches, terms: compiled.terms, pageCount: index.pageCount, textlessPages: index.textlessPages, failedPages: index.failedPages }
}

export function buildTextSplitPlan(pageCount, selectedMatches, { boundary = 'before', collapseConsecutive = false } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Choose a PDF with at least one page.')
  if (!['before', 'after'].includes(boundary)) throw new Error('Choose whether to split before or after the matching page.')
  const selected = [...new Set(selectedMatches)].sort((a, b) => a - b)
  if (selected.some(page => !Number.isInteger(page) || page < 1 || page > pageCount)) throw new Error('A split point is outside this PDF.')
  const markers = []
  for (let index = 0; index < selected.length; index++) {
    const first = selected[index]
    let last = first
    if (collapseConsecutive) while (index + 1 < selected.length && selected[index + 1] === last + 1) last = selected[++index]
    markers.push(boundary === 'before' ? first : last)
  }
  const boundaries = markers.map(page => ({ page, start: boundary === 'before' ? page : page + 1 })).filter(item => item.start > 1 && item.start <= pageCount)
  const starts = [1, ...boundaries.map(item => item.start)]
  const groups = starts.map((start, index) => Array.from({ length: (starts[index + 1] || pageCount + 1) - start }, (_, offset) => start + offset))
  return { groups, boundaries, fileCount: groups.length, selectedCount: selected.length, collapsedCount: selected.length - markers.length, edgeCount: markers.length - boundaries.length, hasSplit: boundaries.length > 0 }
}
