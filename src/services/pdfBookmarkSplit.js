import { getPdfjsLib } from './pdfEngine'
import { splitOutputName } from './pdfSplit'

const check = signal => { if (signal?.aborted) throw new DOMException('Bookmark reading cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const cleanTitle = value => String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()

export function validBookmarkPage(entry, pageCount) { return Number.isInteger(entry.page) && entry.page >= 1 && entry.page <= pageCount }

export async function readBookmarkIndex(source, { signal, onProgress = () => {} } = {}) {
  check(signal)
  const pdfjs = await getPdfjsLib()
  check(signal)
  const task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false, disableFontFace: true })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const pdf = await task.promise
    const outline = await pdf.getOutline()
    check(signal)
    if (!outline?.length) return { entries: [], usableCount: 0, unavailableCount: 0, depths: [], hasOutline: false }
    const flat = [], pending = outline.map((item, index) => ({ item, path: [index], parentId: null, parents: [] })).reverse(), seen = new Set()
    while (pending.length) {
      check(signal)
      const { item, path, parentId, parents } = pending.pop()
      if (!item || seen.has(item)) continue
      seen.add(item)
      const id = path.join('.'), title = cleanTitle(item.title) || `Untitled bookmark ${flat.length + 1}`
      flat.push({ item, id, parentId, title, depth: path.length, parents, order: flat.length })
      for (let index = (item.items?.length || 0) - 1; index >= 0; index--) pending.push({ item: item.items[index], path: [...path, index], parentId: id, parents: [...parents, title] })
      if (flat.length % 100 === 0) await tick()
    }
    const destinations = new Map(), pageRefs = new Map(), entries = []
    for (const [position, record] of flat.entries()) {
      check(signal)
      onProgress(Math.round(position / flat.length * 98), `Resolving bookmark ${position + 1} of ${flat.length}`)
      const { item, ...entry } = record
      let page = null, issue = ''
      try {
        let destination = item.dest
        const external = !!(item.url || item.unsafeUrl)
        if (!external && typeof destination === 'string') {
          if (!destinations.has(destination)) destinations.set(destination, pdf.getDestination(destination))
          destination = await destinations.get(destination)
        }
        check(signal)
        if (external) issue = 'External link, not a page in this PDF'
        else if (Array.isArray(destination) && destination.length) {
          const target = destination[0]
          if (Number.isInteger(target)) page = target + 1
          else if (target && Number.isInteger(target.num)) {
            const key = `${target.num}:${target.gen || 0}`
            if (!pageRefs.has(key)) pageRefs.set(key, pdf.getPageIndex(target))
            page = await pageRefs.get(key) + 1
          }
          if (!Number.isInteger(page) || page < 1 || page > source.pageCount) { page = null; issue = 'Target page could not be resolved' }
        } else issue = 'No internal page target'
      } catch (error) { check(signal); issue = 'Target page could not be resolved' }
      entries.push({ ...entry, page, originalPage: page, issue, bold: !!item.bold, italic: !!item.italic, color: item.color ? Array.from(item.color) : null })
      if (position % 20 === 0) await tick()
    }
    check(signal); onProgress(100, 'Bookmarks ready to review')
    return { entries, usableCount: entries.filter(entry => validBookmarkPage(entry, source.pageCount)).length, unavailableCount: entries.filter(entry => !validBookmarkPage(entry, source.pageCount)).length, depths: [...new Set(entries.map(entry => entry.depth))].sort((a, b) => a - b), hasOutline: true }
  } finally { signal?.removeEventListener('abort', abort); await task.destroy().catch(() => {}) }
}

export function selectBookmarkLevel(entries, level, pageCount) {
  return entries.filter(entry => validBookmarkPage(entry, pageCount) && (level === 'all' || entry.depth === Number(level))).map(entry => entry.id)
}

export function buildBookmarkSplitPlan(pageCount, entries, selectedIds, { frontMatter = 'separate' } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Choose a PDF with at least one page.')
  if (!['separate', 'attach'].includes(frontMatter)) throw new Error('Choose how to include pages before the first bookmark.')
  const ids = new Set(selectedIds), selected = entries.filter(entry => ids.has(entry.id))
  if (!selected.length) return { sections: [], groups: [], fileCount: 0, selectedCount: 0, samePageCount: 0, hasSplit: false, frontMatterPages: 0, reordered: false }
  for (const entry of selected) if (!validBookmarkPage(entry, pageCount)) throw new Error(`“${entry.title}” needs a source page number from 1 to ${pageCount}.`)
  const reordered = selected.some((entry, index) => index > 0 && entry.page < selected[index - 1].page)
  const ordered = [...selected].sort((a, b) => a.page - b.page || a.order - b.order), points = []
  for (const entry of ordered) {
    const last = points.at(-1)
    if (last?.page === entry.page) last.aliases.push(entry.title)
    else points.push({ page: entry.page, title: entry.title, aliases: [], bookmarkId: entry.id })
  }
  const frontMatterPages = points[0].page - 1
  const starts = points.map(point => ({ ...point, start: point.page, frontMatter: false }))
  if (frontMatterPages > 0) {
    if (frontMatter === 'separate') starts.unshift({ page: 1, start: 1, title: 'Front matter', aliases: [], bookmarkId: null, frontMatter: true })
    else starts[0].start = 1
  }
  const sections = starts.map((point, index) => {
    const end = (starts[index + 1]?.start || pageCount + 1) - 1
    return { ...point, end, pages: Array.from({ length: end - point.start + 1 }, (_, offset) => point.start + offset) }
  })
  return { sections, groups: sections.map(section => section.pages), fileCount: sections.length, selectedCount: selected.length, samePageCount: selected.length - points.length, hasSplit: sections.length > 1, frontMatterPages, reordered }
}

export function bookmarkNamePart(value, fallback = 'section') {
  return cleanTitle(value).normalize('NFKC').replace(/[<>:"/\\|?*]/g, '-').replace(/\.pdf$/i, '').slice(0, 90).replace(/[. ]+$/, '') || fallback
}

export function bookmarkOutputName(prefix, section, index, total, naming = 'source-title') {
  if (naming === 'pages') return splitOutputName(prefix, index, section.pages, total)
  const number = String(index + 1).padStart(Math.max(2, String(total).length), '0')
  const title = bookmarkNamePart(section.title)
  return naming === 'title' ? `${number}-${title}.pdf` : `${bookmarkNamePart(prefix, 'document')}-${number}-${title}.pdf`
}
