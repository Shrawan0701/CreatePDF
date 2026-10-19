import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFObjectCopier, PDFPage, PDFRef, PDFStream } from 'pdf-lib'
import { loadPdfBytes } from './pdfEngine'
import { wordPageSelection } from './pdfWordLayout'
import { remapInternalLinks } from './alternateMix'

const name = value => PDFName.of(value)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const check = signal => { if (signal?.aborted) throw new DOMException('Splitting cancelled.', 'AbortError') }

export async function readSplitSource(file, signal) {
  check(signal)
  if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || ''))) throw new Error('Choose a PDF file.')
  const bytes = await loadPdfBytes(file)
  check(signal)
  let document
  try { document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false, throwOnInvalidObject: true }) }
  catch (error) {
    if (/encrypt/i.test(error.message || '')) throw new Error('This PDF is password-protected. Save an unlocked copy with Remove Password, then add it here.')
    throw new Error('Could not open this PDF. Choose a valid, undamaged document.')
  }
  check(signal)
  const pageCount = document.getPageCount()
  if (!pageCount) throw new Error('This PDF has no pages to split.')
  const form = document.catalog.lookupMaybe(name('AcroForm'), PDFDict)
  if (form?.has(name('XFA'))) throw new Error('This PDF uses an XFA form. Save it as a standard PDF before splitting.')
  return { file, bytes, document, pageCount }
}

export function summarizeSplitPages(pages) {
  const parts = []
  for (let index = 0; index < pages.length; index++) {
    const first = pages[index]
    let last = first
    while (index + 1 < pages.length && pages[index + 1] === last + 1) last = pages[++index]
    parts.push(first === last ? String(first) : `${first}–${last}`)
  }
  return parts.join(', ')
}

export function buildSplitPlan(pageCount, options = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Choose a PDF with at least one page.')
  const { mode = 'selection', selected = [], separate = false, rangeInput = '', everyN = 2 } = options
  let groups
  if (mode === 'selection') {
    const pages = [...new Set(selected)].sort((a, b) => a - b)
    if (!pages.length) throw new Error('Select at least one page to extract.')
    if (pages.some(page => !Number.isInteger(page) || page < 1 || page > pageCount)) throw new Error(`Choose pages between 1 and ${pageCount}.`)
    groups = separate ? pages.map(page => [page]) : [pages]
  } else if (mode === 'ranges') {
    const entries = rangeInput.split(/[;\n]/).map(value => value.trim()).filter(Boolean)
    if (!entries.length) throw new Error('Enter at least one range, such as 1-3; 4-6.')
    groups = entries.map((entry, index) => {
      try { return wordPageSelection(entry, pageCount) }
      catch (error) { throw new Error(`File ${index + 1}: ${error.message}`) }
    })
  } else if (mode === 'every') {
    const count = Number(everyN)
    if (!Number.isInteger(count) || count < 1 || count > pageCount) throw new Error(`Enter a whole number from 1 to ${pageCount}.`)
    groups = []
    for (let first = 1; first <= pageCount; first += count) groups.push(Array.from({ length: Math.min(count, pageCount - first + 1) }, (_, index) => first + index))
  } else if (mode === 'individual') groups = Array.from({ length: pageCount }, (_, index) => [index + 1])
  else throw new Error('Choose a split method.')
  const included = new Set(groups.flat())
  return { groups, fileCount: groups.length, pageCount: groups.reduce((sum, pages) => sum + pages.length, 0), uniquePages: included.size, omittedPages: pageCount - included.size, repeatedPages: groups.reduce((sum, pages) => sum + pages.length, 0) - included.size }
}

export function splitOutputName(prefix, index, pages, fileCount) {
  const base = String(prefix || '').trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 120).replace(/[. ]+$/, '') || 'split'
  const number = String(index + 1).padStart(Math.max(2, String(fileCount).length), '0')
  const scope = pages.length === 1 ? `page-${pages[0]}` : pages.at(-1) - pages[0] + 1 === pages.length ? `pages-${pages[0]}-${pages.at(-1)}` : `${pages.length}-pages`
  return `${base}-${number}-${scope}.pdf`
}

// Remove objects left behind by a copied annotation/field tree. All live
// references remain rooted in the output catalog and metadata trailer.
async function pruneOutput(context, signal) {
  const pending = Object.values(context.trailerInfo).filter(Boolean), seen = new Set(), refs = new Set()
  let count = 0
  while (pending.length) {
    check(signal)
    let object = pending.pop()
    if (object instanceof PDFRef) {
      if (refs.has(object.toString())) continue
      refs.add(object.toString()); object = context.lookup(object)
    }
    if (!object || seen.has(object)) continue
    seen.add(object)
    if (object instanceof PDFStream) pending.push(object.dict)
    else if (object instanceof PDFDict) { for (const value of object.values()) pending.push(value) }
    else if (object instanceof PDFArray) { for (let index = 0; index < object.size(); index++) pending.push(object.get(index)) }
    if (++count % 250 === 0) await tick()
  }
  for (const [ref] of context.enumerateIndirectObjects()) if (!refs.has(ref.toString())) context.delete(ref)
}

function retainSelectedForm(source, output, copier, widgets) {
  const original = source.catalog.get(name('AcroForm'))
  if (!original || !widgets.size) return 0
  const formRef = copier.copy(original), form = output.context.lookup(formRef)
  if (!(form instanceof PDFDict)) return 0
  const kept = new Set(), seen = new Set()
  let signaturesCleared = 0
  const retain = value => {
    const field = output.context.lookup(value)
    if (!(field instanceof PDFDict) || seen.has(field)) return false
    seen.add(field)
    const kids = field.lookupMaybe(name('Kids'), PDFArray)
    if (kids) {
      for (let index = kids.size() - 1; index >= 0; index--) if (!retain(kids.get(index))) kids.remove(index)
    }
    const keep = widgets.has(field) || !!kids?.size()
    if (keep) {
      kept.add(field)
      // New PDF bytes cannot retain the original certificate's validity. Keep
      // the visible appearance and empty signature field, not an invalid /V.
      if (field.lookup(name('FT')) === name('Sig') && field.has(name('V'))) {
        field.delete(name('V')); signaturesCleared++
      }
    }
    return keep
  }
  const fields = form.lookupMaybe(name('Fields'), PDFArray)
  if (!fields) return 0
  for (let index = fields.size() - 1; index >= 0; index--) if (!retain(fields.get(index))) fields.remove(index)
  if (!fields.size()) return 0
  const calculationOrder = form.lookupMaybe(name('CO'), PDFArray)
  if (calculationOrder) for (let index = calculationOrder.size() - 1; index >= 0; index--) if (!kept.has(output.context.lookup(calculationOrder.get(index)))) calculationOrder.remove(index)
  output.catalog.set(name('AcroForm'), formRef)
  if (signaturesCleared) form.delete(name('SigFlags'))
  return signaturesCleared
}

function retainOutputBookmarks(output, copies, entries) {
  if (!entries?.length) return 0
  const all = new Map(entries.map(entry => [entry.id, entry]))
  const kept = new Map(entries.filter(entry => copies.has(entry.page)).map(entry => [entry.id, { entry, ref: output.context.nextRef(), children: [] }]))
  if (!kept.size) return 0
  const root = output.context.nextRef(), roots = []
  for (const record of kept.values()) {
    let parentId = record.entry.parentId
    const visited = new Set([record.entry.id])
    while (parentId && !kept.has(parentId) && !visited.has(parentId)) { visited.add(parentId); parentId = all.get(parentId)?.parentId }
    const parent = parentId && !visited.has(parentId) ? kept.get(parentId) : null
    if (parent) parent.children.push(record)
    else roots.push(record)
  }
  // Children outside this section are removed; retained descendants are
  // promoted to the nearest retained ancestor and target actual output pages.
  const queue = [{ siblings: roots, parentRef: root }]
  while (queue.length) {
    const { siblings, parentRef } = queue.pop()
    for (const [index, record] of siblings.entries()) {
      const { entry, ref, children } = record
      const dict = output.context.obj({ Title: PDFHexString.fromText(entry.title), Parent: parentRef, Dest: [copies.get(entry.page).ref, 'Fit'], F: (entry.bold ? 2 : 0) + (entry.italic ? 1 : 0) })
      if (index > 0) dict.set(name('Prev'), siblings[index - 1].ref)
      if (index + 1 < siblings.length) dict.set(name('Next'), siblings[index + 1].ref)
      if (entry.color?.length === 3 && entry.color.every(value => Number.isFinite(value))) dict.set(name('C'), output.context.obj(entry.color.map(value => Math.max(0, Math.min(1, value / 255)))))
      if (children.length) { dict.set(name('First'), children[0].ref); dict.set(name('Last'), children.at(-1).ref); queue.push({ siblings: children, parentRef: ref }) }
      output.context.assign(ref, dict)
    }
  }
  const counts = new Map(), postorder = [...kept.values()].reverse()
  // Source entries are in depth-first order, so descendants are counted first.
  for (const record of postorder) {
    const count = record.children.reduce((sum, child) => sum + 1 + (counts.get(child.ref) || 0), 0)
    counts.set(record.ref, count)
    if (count) output.context.lookup(record.ref, PDFDict).set(name('Count'), output.context.obj(count))
  }
  output.context.assign(root, output.context.obj({ Type: 'Outlines', First: roots[0].ref, Last: roots.at(-1).ref, Count: kept.size }))
  output.catalog.set(name('Outlines'), root)
  return kept.size
}

export async function splitLoadedPdf(source, groups, { signal, onProgress = () => {}, bookmarks = null, transformPage = null } = {}) {
  check(signal)
  if (!source?.document || !groups?.length) throw new Error('Choose a PDF and at least one output group.')
  for (const pages of groups) if (!pages.length || new Set(pages).size !== pages.length || pages.some(page => !Number.isInteger(page) || page < 1 || page > source.pageCount)) throw new Error('Each output must contain valid, distinct source pages.')
  const results = [], originals = source.document.getPages()
  const total = groups.reduce((sum, pages) => sum + pages.length, 0)
  let completed = 0
  for (const [index, pages] of groups.entries()) {
    check(signal)
    const output = await PDFDocument.create({ updateMetadata: false })
    const copier = PDFObjectCopier.for(source.document.context, output.context)
    const pageRefs = new Map(pages.map(number => [number, output.context.nextRef()]))
    // Reserve every selected page before copying any resources. References to
    // omitted pages become null, so links/widgets cannot secretly copy their
    // complete pages into the output file.
    originals.forEach((page, pageIndex) => copier.traversedObjects.set(page.ref, pageRefs.get(pageIndex + 1) || PDFNull))
    const copies = new Map(), widgets = new Set()
    for (const number of pages) {
      check(signal)
      const ref = pageRefs.get(number), node = copier.copy(originals[number - 1].node)
      output.context.assign(ref, node)
      const page = PDFPage.of(node, ref, output)
      output.addPage(page); copies.set(number, page)
      const annotations = page.node.Annots()
      for (let annotationIndex = 0; annotations && annotationIndex < annotations.size(); annotationIndex++) {
        const annotation = annotations.lookup(annotationIndex)
        if (!(annotation instanceof PDFDict)) continue
        annotation.set(name('P'), page.ref)
        if (annotation.lookup(name('Subtype')) === name('Widget')) widgets.add(annotation)
      }
      completed++
      onProgress(Math.round(completed / total * 88), `Creating file ${index + 1} of ${groups.length} · page ${number}`)
      await tick()
    }
    const skippedLinks = remapInternalLinks(source.document, copies, output)
    if (transformPage) {
      for (const [pageNumber, page] of copies) {
        check(signal)
        await transformPage({ page, original: originals[pageNumber - 1], pageNumber, outputIndex: index, output, copies })
      }
      // A page transform may remove widgets outside its visible area. Only
      // fields whose annotations remain on an output page belong in its form.
      widgets.clear()
      for (const page of copies.values()) {
        const annotations = page.node.Annots()
        for (let annotationIndex = 0; annotations && annotationIndex < annotations.size(); annotationIndex++) {
          const annotation = annotations.lookup(annotationIndex)
          if (annotation instanceof PDFDict && annotation.lookup(name('Subtype')) === name('Widget')) widgets.add(annotation)
        }
      }
    }
    const signaturesCleared = retainSelectedForm(source.document, output, copier, widgets)
    if (source.document.context.trailerInfo.Info) output.context.trailerInfo.Info = copier.copy(source.document.context.trailerInfo.Info)
    for (const key of ['Metadata', 'Lang', 'ViewerPreferences']) {
      const value = source.document.catalog.get(name(key))
      if (value) output.catalog.set(name(key), copier.copy(value))
    }
    const bookmarksRetained = retainOutputBookmarks(output, copies, bookmarks)
    await pruneOutput(output.context, signal)
    const bytes = await output.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false, objectsPerTick: 30 })
    check(signal)
    results.push({ blob: new Blob([bytes], { type: 'application/pdf' }), pages: [...pages], skippedLinks, signaturesCleared, bookmarksRetained })
    await tick()
  }
  onProgress(100, `${results.length} PDF${results.length === 1 ? '' : 's'} ready`)
  return results
}
