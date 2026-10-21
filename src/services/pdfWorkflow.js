import { loadPdfBytes, mergePdfs } from './pdfEngine'

export const WORKFLOW_OPERATIONS = {
  images: { label: 'Images to PDF', description: 'Convert each image in place, preserving source order.', defaults: { paper: 'a4', orientation: 'auto', margin: 18 } },
  merge: { label: 'Merge PDFs', description: 'Combine the current PDFs in their listed order.', defaults: {} },
  rotate: { label: 'Rotate pages', description: 'Turn all pages or a specific page range.', defaults: { angle: 90, pages: '' } },
  reorder: { label: 'Reorder / extract pages', description: 'Choose a page sequence for each current PDF.', defaults: { order: '1-', keepRemaining: true } },
  split: { label: 'Split PDFs', description: 'Create separate PDFs every set number of pages.', defaults: { every: 1 } },
  watermark: { label: 'Watermark', description: 'Add a text watermark to each current PDF.', defaults: { text: 'CONFIDENTIAL', opacity: 25, rotation: 45, fontSize: 48, position: 'center', color: '#808080', pages: '' } },
  numbers: { label: 'Page numbers', description: 'Number pages; the sequence restarts in each PDF.', defaults: { format: 'full', startAt: 1, position: 'bottom-center', fontSize: 10, pages: '' } },
  compress: { label: 'Compress', description: 'Optimize each PDF while retaining its content.', defaults: { mode: 'balanced' } },
}

export const WORKFLOW_PRESETS = [
  { name: 'Combine & number', description: 'Merge → page numbers → compress', types: ['merge', 'numbers', 'compress'] },
  { name: 'Prepare for sharing', description: 'Watermark → compress', types: ['watermark', 'compress'] },
  { name: 'Images to one PDF', description: 'Convert images → merge → compress', types: ['images', 'merge', 'compress'] },
]

const id = () => globalThis.crypto.randomUUID()
const check = signal => { if (signal?.aborted) throw new DOMException('Workflow cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
// Strip filesystem separators and control characters from user filenames.
// eslint-disable-next-line no-control-regex
export const workflowFilename = (value, extension = 'pdf') => `${String(value || 'workflow').trim().replace(/\.(pdf|zip|json)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100) || 'workflow'}.${extension}`
export const makeWorkflowStep = type => ({ id: id(), type, enabled: true, settings: { ...WORKFLOW_OPERATIONS[type].defaults } })

export function normalizeWorkflowStep(raw) {
  if (!raw || !Object.hasOwn(WORKFLOW_OPERATIONS, raw.type)) throw new Error('The configuration contains an unsupported operation.')
  if (raw.enabled != null && typeof raw.enabled !== 'boolean') throw new Error('Step enabled status must be true or false.')
  if (raw.settings != null && (typeof raw.settings !== 'object' || Array.isArray(raw.settings))) throw new Error('Operation settings must be an object.')
  const step = makeWorkflowStep(raw.type)
  step.enabled = raw.enabled !== false
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    for (const key of Object.keys(step.settings)) if (Object.hasOwn(raw.settings, key)) {
      const value = raw.settings[key], expected = typeof step.settings[key]
      if (typeof value !== expected && !(expected === 'number' && typeof value === 'string')) throw new Error(`Invalid setting: ${key}.`)
      step.settings[key] = value
    }
  } else if (typeof raw.value === 'string') {
    const value = raw.value
    if (raw.type === 'rotate') step.settings.angle = Number(value || 90)
    if (raw.type === 'reorder') step.settings.order = value || '1-'
    if (raw.type === 'compress') step.settings.mode = value || 'balanced'
    if (raw.type === 'watermark') step.settings.text = value || 'CONFIDENTIAL'
    if (raw.type === 'numbers') { step.settings.format = 'custom'; step.settings.template = `${value}{number}` }
  }
  // Legacy number prefixes are kept as an explicit custom format.
  if (raw.type === 'numbers' && raw.settings?.format === 'custom' && typeof raw.settings.template === 'string') step.settings.template = raw.settings.template
  return step
}

export function workflowConfiguration(name, steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 50) throw new Error('Use between 1 and 50 workflow steps.')
  const normalized = steps.map(normalizeWorkflowStep)
  for (const [index, step] of normalized.entries()) {
    const error = validateWorkflowStep(step)
    if (error && step.enabled) throw new Error(`Step ${index + 1}: ${error}`)
  }
  if (!normalized.some(step => step.enabled)) throw new Error('Enable at least one step.')
  return { version: 2, name: String(name || 'My workflow').trim().slice(0, 120) || 'My workflow', steps: normalized }
}

export function parseWorkflowConfiguration(text) {
  if (text.length > 1000000) throw new Error('The workflow configuration is too large.')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('Choose a valid workflow JSON configuration.') }
  if (!value || (value.version != null && ![1, 2].includes(value.version))) throw new Error('This workflow configuration version is not supported.')
  return workflowConfiguration(value.name, value.steps)
}

// Strict ranges: ordered selections support descending ranges and
// open ends. Nothing invalid or out of bounds is silently discarded.
export function workflowPages(input, pageCount, { ordered = false, keepRemaining = false } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('This PDF has no pages.')
  if (typeof input !== 'string') throw new Error('Enter a page range as text.')
  if (!input.trim()) {
    if (ordered) throw new Error('Enter a page order, such as 3, 1-2.')
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  const pages = [], seen = new Set()
  for (const token of input.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d*))?$/)
    if (!match) throw new Error('Use pages such as 1-3, 5 or 3-1. An open range such as 2- runs to the end.')
    const first = Number(match[1]), last = match[2] === undefined ? first : match[2] === '' ? pageCount : Number(match[2])
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || Math.min(first, last) < 1 || Math.max(first, last) > pageCount) throw new Error(`Choose pages between 1 and ${pageCount}.`)
    const direction = first <= last ? 1 : -1
    for (let page = first; direction > 0 ? page <= last : page >= last; page += direction) {
      if (ordered && seen.has(page)) throw new Error(`Page ${page} appears more than once. Use each page once in the order.`)
      if (ordered || !seen.has(page)) pages.push(page)
      seen.add(page)
      if (pages.length > 50000) throw new Error('Use no more than 50,000 pages in one selection.')
    }
  }
  if (keepRemaining) for (let page = 1; page <= pageCount; page++) if (!seen.has(page)) pages.push(page)
  return ordered ? pages : pages.sort((a, b) => a - b)
}

function rangeSyntax(value, allowEmpty = true) {
  return typeof value === 'string' && value.length <= 5000 && ((allowEmpty && !value.trim()) || value.split(',').every(token => /^\d+(?:\s*-\s*\d*)?$/.test(token.trim())))
}

export function validateWorkflowStep(step) {
  const op = WORKFLOW_OPERATIONS[step.type], s = step.settings
  if (!op || !s || typeof s !== 'object') return 'Choose a supported operation.'
  const number = (key, low, high, integer = false) => typeof s[key] !== 'boolean' && String(s[key]).trim() !== '' && Number.isFinite(Number(s[key])) && Number(s[key]) >= low && Number(s[key]) <= high && (!integer || Number.isInteger(Number(s[key])))
  if (step.type === 'images' && (!['a4', 'letter', 'image'].includes(s.paper) || !['auto', 'portrait', 'landscape'].includes(s.orientation) || ![0, 18, 36].includes(Number(s.margin)))) return 'Choose a valid image page size, orientation and margin.'
  if (step.type === 'rotate' && ![90, 180, 270].includes(Number(s.angle))) return 'Choose a rotation of 90°, 180° or 270°.'
  if (['rotate', 'watermark', 'numbers'].includes(step.type) && !rangeSyntax(s.pages)) return 'Enter valid page ranges, or leave Pages blank for all pages.'
  if (step.type === 'reorder' && (!rangeSyntax(s.order, false) || typeof s.keepRemaining !== 'boolean')) return 'Enter a page order, such as 3, 1-2.'
  if (step.type === 'split' && !number('every', 1, 10000, true)) return 'Pages per file must be a whole number from 1 to 10,000.'
  if (step.type === 'compress' && !['lossless', 'balanced', 'strong'].includes(s.mode)) return 'Choose a compression preset.'
  if (step.type === 'watermark') {
    if (typeof s.text !== 'string' || !s.text.trim() || s.text.length > 500 || s.text.split('\n').length > 5) return 'Enter watermark text, up to 500 characters and five lines.'
    if (!number('opacity', 1, 100) || !number('rotation', -180, 180) || !number('fontSize', 8, 144) || !['center', 'top-center', 'bottom-center'].includes(s.position) || !/^#[0-9a-f]{6}$/i.test(s.color)) return 'Check the watermark size, opacity, angle, position and colour.'
  }
  if (step.type === 'numbers') {
    if (!['number', 'page', 'fraction', 'full', 'custom'].includes(s.format) || !number('startAt', 0, 999999999, true) || !number('fontSize', 6, 72) || !['bottom-left', 'bottom-center', 'bottom-right', 'top-center'].includes(s.position)) return 'Choose a valid page number format, start number, position and size.'
    if (s.format === 'custom' && (typeof s.template !== 'string' || s.template.length > 200 || !/\{number\}/.test(s.template) || /[\r\n\t]/.test(s.template) || /\{[^{}]*\}/.test(s.template.replace(/\{(?:number|total|page|pages|count)\}/g, '')))) return 'Custom number format must contain {number}; supported tokens include {total} and {pages}.'
  }
  return ''
}

const summary = entries => ({ files: entries.length, pages: entries.reduce((sum, entry) => sum + entry.pageCount, 0), images: entries.filter(entry => entry.kind === 'image').length })
export function planWorkflow(sources, steps) {
  let current = sources.map(source => ({ kind: source.kind, pageCount: source.pageCount, name: source.file.name }))
  const rows = [], errors = []
  let blocked = false
  for (const [index, step] of steps.entries()) {
    const input = summary(current)
    let error = validateWorkflowStep(step)
    if (step.enabled !== false && !error && sources.length && !blocked) {
      try {
        const s = step.settings
        if (step.type === 'images') {
          if (!current.some(entry => entry.kind === 'image')) throw new Error('No images remain to convert. Add images or remove this step.')
          current = current.map(entry => ({ ...entry, kind: 'pdf' }))
        } else {
          if (current.some(entry => entry.kind === 'image')) throw new Error('Add an Images to PDF step before this operation. All source files must be used.')
          if (step.type === 'merge') current = [{ kind: 'pdf', pageCount: input.pages, name: 'Merged PDF' }]
          else if (step.type === 'split') {
            if (current.reduce((sum, entry) => sum + Math.ceil(entry.pageCount / Number(s.every)), 0) > 2000) throw new Error('This workflow creates more than 2,000 files. Increase pages per split file.')
            current = current.flatMap(entry => Array.from({ length: Math.ceil(entry.pageCount / Number(s.every)) }, (_, part) => ({ ...entry, pageCount: Math.min(Number(s.every), entry.pageCount - part * Number(s.every)) })))
          }
          else for (const entry of current) {
            if (step.type === 'reorder') entry.pageCount = workflowPages(s.order, entry.pageCount, { ordered: true, keepRemaining: s.keepRemaining }).length
            if (['rotate', 'watermark', 'numbers'].includes(step.type)) {
              const count = workflowPages(s.pages, entry.pageCount).length
              if (step.type === 'numbers' && Number(s.startAt) + count - 1 > 999999999) throw new Error('The final page number exceeds 999,999,999.')
            }
          }
        }
        if (current.length > 2000) throw new Error('This workflow creates more than 2,000 files. Increase pages per split file.')
      } catch (failure) { error = failure.message }
    }
    if (step.enabled !== false && error) { errors.push(`Step ${index + 1}: ${error}`); blocked = true }
    rows.push({ id: step.id, input, output: summary(current), error: step.enabled === false ? '' : error, skipped: step.enabled === false, blocked: blocked && !error })
  }
  if (!steps.some(step => step.enabled !== false)) errors.push('Add and enable at least one step.')
  if (sources.length && !errors.length && current.some(entry => entry.kind === 'image')) errors.push('Convert the remaining images to PDF before finishing the workflow.')
  return { rows, errors, output: summary(current), ready: sources.length > 0 && !errors.length }
}

export async function readWorkflowSource(file, signal) {
  check(signal)
  if (!file.size) throw new Error('This file is empty.')
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const { readSplitSource } = await import('./pdfSplit')
    const source = await readSplitSource(file, signal)
    return { id: id(), file, kind: 'pdf', pageCount: source.pageCount }
  }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name)) throw new Error('Choose a PDF or image file.')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); check(signal)
    return { id: id(), file, kind: 'image', pageCount: 1, width: bitmap.width, height: bitmap.height }
  } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Could not read this image. Try JPG, PNG or WebP.') }
  finally { bitmap?.close() }
}

export async function runPdfWorkflow(sources, steps, { signal, onProgress, onStep, name = 'workflow' } = {}) {
  const plan = planWorkflow(sources, steps)
  if (!plan.ready) throw new Error(plan.errors[0] || 'Add source files before running the workflow.')
  check(signal)
  const active = steps.filter(step => step.enabled !== false), history = []
  let current = sources.map(source => ({ ...source, warnings: [] }))
  for (const [stepIndex, step] of active.entries()) {
    const label = WORKFLOW_OPERATIONS[step.type].label, started = Date.now(), input = summary(current)
    onStep?.({ id: step.id, status: 'running', label })
    const report = (fraction, detail) => { check(signal); onProgress?.((stepIndex + fraction) / active.length * 100, detail || label) }
    try {
      const s = step.settings, next = []
      if (step.type === 'merge') {
        report(0, 'Combining PDFs in source order…')
        const file = current.length === 1 ? current[0].file : new File([await mergePdfs(current.map(entry => entry.file))], 'merged.pdf', { type: 'application/pdf' })
        check(signal)
        next.push({ id: id(), kind: 'pdf', file, pageCount: input.pages, warnings: current.flatMap(entry => entry.warnings) })
      } else for (const [fileIndex, source] of current.entries()) {
        check(signal); await tick()
        const progress = value => report((fileIndex + value / 100) / current.length, `${label} · file ${fileIndex + 1} of ${current.length}`)
        progress(0)
        let blob, pageCount = source.pageCount
        const warnings = [...source.warnings]
        if (step.type === 'images') {
          if (source.kind !== 'image') { next.push(source); continue }
          const { SCAN_DEFAULTS, createScannedPdf } = await import('./scanDocument')
          blob = await createScannedPdf([{ ...source, ...SCAN_DEFAULTS }], { ...s, fit: 'fit' }, progress)
        } else if (step.type === 'split' || step.type === 'reorder') {
          const { readSplitSource, splitLoadedPdf } = await import('./pdfSplit')
          const loaded = await readSplitSource(source.file, signal)
          const order = step.type === 'reorder' ? workflowPages(s.order, pageCount, { ordered: true, keepRemaining: s.keepRemaining }) : null
          const groups = order ? [order] : Array.from({ length: Math.ceil(pageCount / Number(s.every)) }, (_, part) => Array.from({ length: Math.min(Number(s.every), pageCount - part * Number(s.every)) }, (_, index) => part * Number(s.every) + index + 1))
          const outputs = await splitLoadedPdf(loaded, groups, { signal, onProgress: progress })
          for (const [part, output] of outputs.entries()) next.push({ id: id(), kind: 'pdf', file: new File([output.blob], step.type === 'split' ? `${source.file.name.replace(/\.pdf$/i, '')}-part-${String(part + 1).padStart(2, '0')}.pdf` : source.file.name, { type: 'application/pdf' }), pageCount: groups[part].length, warnings: [...warnings] })
          continue
        } else if (step.type === 'rotate') {
          const { PDFDocument, degrees } = await import('pdf-lib')
          const document = await PDFDocument.load(await loadPdfBytes(source.file), { updateMetadata: false })
          for (const [index, number] of workflowPages(s.pages, pageCount).entries()) {
            check(signal)
            const page = document.getPage(number - 1)
            page.setRotation(degrees((page.getRotation().angle + Number(s.angle)) % 360))
            if (index % 50 === 0) await tick()
          }
          blob = new Blob([await document.save()], { type: 'application/pdf' })
        } else if (step.type === 'compress') {
          const { compressPdfDetailed } = await import('./pdfCompression')
          const compressed = await compressPdfDetailed(source.file, { mode: s.mode, signal, onProgress: progress })
          blob = compressed.blob
          if (compressed.reason === 'signed') warnings.push('Compression kept this digitally signed PDF unchanged.')
          else if (!(compressed.savedBytes > 0)) warnings.push('Compression retained the smaller original; no further size reduction was available.')
        } else if (step.type === 'watermark') {
          const { readWatermarkSource, createWatermarkedPdf, watermarkDefaults } = await import('./pdfWatermark')
          blob = await createWatermarkedPdf(await readWatermarkSource(source.file, { signal }), { ...watermarkDefaults(), ...s, pagesMode: s.pages.trim() ? 'custom' : 'all', range: s.pages.trim() ? workflowPages(s.pages, pageCount).join(',') : '' }, null, { signal, onProgress: progress })
        } else if (step.type === 'numbers') {
          const { addPageNumbers } = await import('./pdfEngine')
          blob = await addPageNumbers(source.file, { ...s, pageRange: s.pages.trim() ? workflowPages(s.pages, pageCount).join(',') : '', signal, onProgress: progress })
        }
        check(signal)
        if (!blob) throw new Error('This operation did not produce a PDF.')
        next.push({ ...source, kind: 'pdf', file: new File([blob], source.file.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' }), pageCount, warnings })
      }
      check(signal); current = next
      const record = { id: step.id, status: 'done', label, input, output: summary(current), duration: Date.now() - started }
      history.push(record); onStep?.(record); report(1)
    } catch (failure) {
      if (failure.name === 'AbortError') throw failure
      onStep?.({ id: step.id, status: 'error', label, error: failure.message })
      throw new Error(`${label}: ${failure.message}`)
    }
  }
  check(signal)
  const { planPdfArchive } = await import('./pdfZip')
  const named = current.map((entry, index) => new File([entry.file], current.length === 1 ? workflowFilename(name) : `${String(index + 1).padStart(2, '0')}-${workflowFilename(entry.file.name)}`, { type: 'application/pdf' }))
  const entries = planPdfArchive(named).map((entry, index) => ({ ...entry, id: id(), pageCount: current[index].pageCount, warnings: [...new Set(current[index].warnings)] }))
  return { entries, history, totalPages: summary(current).pages, totalBytes: entries.reduce((sum, entry) => sum + entry.file.size, 0) }
}
