import { PDFDocument } from 'pdf-lib'

const check = signal => { if (signal?.aborted) throw new DOMException('Redaction cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

export function redactionTargetPages(input, total) {
  const value = String(input || '').trim().toLowerCase()
  if (!value || value === 'all') return Array.from({ length: total }, (_, index) => index + 1)
  if (value === 'odd' || value === 'even') return Array.from({ length: total }, (_, index) => index + 1).filter(number => number % 2 === (value === 'odd' ? 1 : 0))
  const pages = new Set()
  for (const token of value.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use pages such as 1-3, 5, all, odd or even.')
    const start = Number(match[1]), end = Number(match[2] || match[1])
    if (start < 1 || end < start || end > total) throw new Error(`Pages must be between 1 and ${total}.`)
    for (let page = start; page <= end; page++) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

export async function createRedactedPdf(source, regions, { dpi = 200, signal, onProgress } = {}) {
  check(signal)
  if (!regions.length) throw new Error('Mark at least one area to redact.')
  const resolution = Number(dpi)
  if (![150, 200, 300].includes(resolution)) throw new Error('Choose a supported export quality.')
  const groups = new Map()
  for (const region of regions) {
    if (!Number.isInteger(region.page) || region.page < 1 || region.page > source.pdf.numPages || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001 || !['#000000', '#ffffff'].includes(region.color)) throw new Error('One redaction area is invalid. Resize or remove it before exporting.')
    if (!groups.has(region.page)) groups.set(region.page, [])
    groups.get(region.page).push(region)
  }
  // Build a fresh, image-only document. Never copy the original page objects,
  // content streams, forms, attachments, layers, annotations or metadata.
  // Painting over an original PDF stream would leave recoverable information.
  const output = await PDFDocument.create()
  output.setTitle('Redacted document'); output.setCreator('CreatePDF.si')
  for (let number = 1; number <= source.pdf.numPages; number++) {
    check(signal); onProgress?.((number - 1) / source.pdf.numPages * 94, `Redacting page ${number} of ${source.pdf.numPages}…`); await tick()
    const page = await source.pdf.getPage(number), native = page.getViewport({ scale: 1 })
    const scale = Math.min(resolution / 72, 8192 / Math.max(native.width, native.height), Math.sqrt(16_000_000 / (native.width * native.height)))
    const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas')
    let task
    const abort = () => task?.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      check(signal)
      canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      task = page.render({ canvasContext: context, viewport, background: '#ffffff' })
      await task.promise; check(signal)
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'
      for (const region of groups.get(number) || []) {
        // Round outwards and cover edge pixels so downsampling/antialiasing
        // cannot leave a sliver of the marked content at a rectangle boundary.
        const left = Math.max(0, Math.floor(region.x * canvas.width) - 1), top = Math.max(0, Math.floor(region.y * canvas.height) - 1)
        const right = Math.min(canvas.width, Math.ceil((region.x + region.width) * canvas.width) + 1), bottom = Math.min(canvas.height, Math.ceil((region.y + region.height) * canvas.height) + 1)
        context.fillStyle = region.color; context.fillRect(left, top, right - left, bottom - top)
      }
      context.restore(); check(signal)
      // PNG encoding is lossless: covered pixels remain opaque, solid colours.
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the redacted page.')), 'image/png'))
      check(signal)
      const image = await output.embedPng(await blob.arrayBuffer()); check(signal)
      const target = output.addPage([native.width, native.height]); target.drawImage(image, { x: 0, y: 0, width: native.width, height: native.height })
    } catch (error) {
      check(signal)
      throw new Error(`Page ${number}: ${error.message || 'Could not redact this page.'}`)
    } finally { signal?.removeEventListener('abort', abort); canvas.width = canvas.height = 0 }
  }
  check(signal); onProgress?.(97, 'Finishing redacted PDF…'); await tick()
  const bytes = await output.save({ useObjectStreams: true }); check(signal); onProgress?.(100, 'Redacted PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
