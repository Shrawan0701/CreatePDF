import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib'
import { getPdfjsLib, loadPdfBytes } from './pdfEngine'
import { decodedImagePixels } from './pdfImages'

export const COMPRESSION_PRESETS = {
  lossless: { label: 'Original quality', detail: 'Optimize PDF data without changing image pixels.', quality: 1, maxEdge: 0 },
  balanced: { label: 'Balanced', detail: 'Smaller photos and scans, with clear everyday detail.', quality: .76, maxEdge: 2200 },
  strong: { label: 'Smallest size', detail: 'More compression for sharing. Image detail is reduced.', quality: .52, maxEdge: 1400 },
  custom: { label: 'Custom', detail: 'Choose image quality and resolution yourself.', quality: .76, maxEdge: 2200 },
}

const name = value => PDFName.of(value)
const isImage = object => object instanceof PDFRawStream && object.dict.lookup(name('Subtype')) === name('Image')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function cancelled(signal) { if (signal?.aborted) throw new DOMException('Compression cancelled.', 'AbortError') }
function refKey(ref) { return `${ref.objectNumber}R${ref.generationNumber || ''}` }
function number(dict, key) { const value = dict.lookup(name(key)); return value instanceof PDFNumber ? value.asNumber() : 0 }

async function hasDigitalSignature(context, signal) {
  const pending = context.enumerateIndirectObjects().map(([, object]) => object), seen = new Set()
  let visits = 0
  while (pending.length) {
    cancelled(signal)
    const object = pending.pop()
    if (!object || seen.has(object)) continue
    seen.add(object)
    if (object instanceof PDFStream) pending.push(object.dict)
    else if (object instanceof PDFDict) {
      if (object.has(name('ByteRange')) && object.has(name('Contents'))) return true
      pending.push(...object.values())
    } else if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index++) pending.push(object.get(index))
    }
    if (++visits % 250 === 0) await tick()
  }
  return false
}

// Traverse the complete document, not just page resources. This retains links,
// named destinations, outlines, forms, attachments, metadata and tagged structure.
async function pruneUnused(context, signal, aliases = new Map()) {
  const pending = Object.values(context.trailerInfo).filter(Boolean)
  const seen = new Set(), refs = new Set()
  let visits = 0
  const canonical = value => value instanceof PDFRef ? aliases.get(value.toString()) || value : value
  while (pending.length) {
    cancelled(signal)
    let object = canonical(pending.pop())
    if (object instanceof PDFRef) {
      if (refs.has(object.toString())) continue
      refs.add(object.toString())
      object = context.lookup(object)
    }
    if (!object || seen.has(object)) continue
    seen.add(object)
    if (object instanceof PDFStream) pending.push(object.dict)
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const next = canonical(value)
        if (next !== value) object.set(key, next)
        pending.push(next)
      }
    } else if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index++) {
        const value = object.get(index), next = canonical(value)
        if (next !== value) object.set(index, next)
        pending.push(next)
      }
    }
    if (++visits % 250 === 0) await tick()
  }
  let removed = 0
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!refs.has(ref.toString())) { context.delete(ref); removed++ }
  }
  return removed
}

async function transformBytes(bytes, decompress, signal, limit = 64 * 1024 * 1024) {
  cancelled(signal)
  const Transformer = decompress ? globalThis.DecompressionStream : globalThis.CompressionStream
  if (!Transformer) throw new Error('Stream compression is unavailable in this browser.')
  const reader = new Blob([bytes]).stream().pipeThrough(new Transformer('deflate')).getReader()
  const abort = () => { reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const chunks = []
  let length = 0
  try {
    while (true) {
      cancelled(signal)
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new Error('Stream exceeds the optimization memory limit.')
      chunks.push(value)
    }
    cancelled(signal)
    const output = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
    return output
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function imageObject(page, id, signal) {
  const objects = id.startsWith('g_') ? page.commonObjs : page.objs
  if (objects.has(id)) return Promise.resolve(objects.get(id))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(value)
    }
    const abort = () => finish(new DOMException('Compression cancelled.', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('Image decoding timed out.')), 15000)
    signal?.addEventListener('abort', abort, { once: true })
    objects.get(id, image => finish(null, image))
    if (signal?.aborted) abort()
  })
}

async function imageJpeg(image, settings, signal) {
  const input = document.createElement('canvas'), output = document.createElement('canvas')
  try {
    input.width = image.width; input.height = image.height
    const context = input.getContext('2d')
    if (!context) throw new Error('Could not allocate an image canvas.')
    if (image.bitmap) context.drawImage(image.bitmap, 0, 0)
    else context.putImageData(new ImageData(decodedImagePixels(image), image.width, image.height), 0, 0)
    const scale = Math.min(1, settings.maxEdge / Math.max(image.width, image.height))
    output.width = Math.max(1, Math.round(image.width * scale))
    output.height = Math.max(1, Math.round(image.height * scale))
    const target = output.getContext('2d')
    if (!target) throw new Error('Could not allocate an image canvas.')
    target.fillStyle = '#fff'; target.fillRect(0, 0, output.width, output.height)
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'high'
    target.drawImage(input, 0, 0, output.width, output.height)
    cancelled(signal)
    const blob = await new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/jpeg', settings.quality))
    if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable.')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: output.width, height: output.height }
  } finally { input.width = input.height = output.width = output.height = 0 }
}

function eligibleImages(context) {
  const protectedMasks = new Set(), candidates = new Map()
  const entries = context.enumerateIndirectObjects()
  for (const [, stream] of entries) {
    if (!isImage(stream)) continue
    for (const key of ['SMask', 'Mask']) {
      const ref = stream.dict.get(name(key))
      if (ref instanceof PDFRef) protectedMasks.add(ref.toString())
    }
  }
  for (const [ref, stream] of entries) {
    if (!isImage(stream) || protectedMasks.has(ref.toString())) continue
    const dict = stream.dict, width = number(dict, 'Width'), height = number(dict, 'Height')
    // Retain transparency, stencils, monochrome scan codecs and small graphics
    // unchanged. Re-encoding these as JPEG can introduce halos or blur text.
    if (['SMask', 'Mask', 'ImageMask', 'SMaskInData', 'Alternates', 'OPI'].some(key => dict.has(name(key)))) continue
    if (number(dict, 'BitsPerComponent') !== 8 || Math.min(width, height) < 128 || width * height > 32_000_000 || stream.contents.length < 8192) continue
    // External streams and prepress replacement images need their original
    // interpretation; avoid substituting a page-decoded rendition for them.
    if (dict.has(name('F'))) continue
    const color = dict.lookup(name('ColorSpace'))
    let supported = color === name('DeviceRGB') || color === name('DeviceGray')
    if (color instanceof PDFArray && color.lookup(0) === name('ICCBased')) {
      const profile = color.lookup(1)
      supported = profile instanceof PDFStream && [1, 3].includes(number(profile.dict, 'N'))
    }
    if (supported) candidates.set(refKey(ref), { ref, stream, width, height })
  }
  return candidates
}

async function optimizeImages(bytes, document, settings, stats, progress, signal) {
  const candidates = eligibleImages(document.context)
  if (!candidates.size) return
  const pdfjs = await getPdfjsLib()
  cancelled(signal)
  const task = pdfjs.getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, maxImageSize: 32_000_000, disableFontFace: true, isEvalSupported: false })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const seen = new Set()
  try {
    const pdf = await task.promise
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      cancelled(signal)
      progress(10 + Math.round((pageNumber - 1) / pdf.numPages * 65), `Optimizing images on page ${pageNumber} of ${pdf.numPages}`)
      const page = await pdf.getPage(pageNumber)
      try {
        const operators = await page.getOperatorList(), ids = new Set()
        for (let index = 0; index < operators.fnArray.length; index++) {
          if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintImageXObjectRepeat].includes(operators.fnArray[index])) ids.add(operators.argsArray[index][0])
        }
        for (const id of ids) {
          cancelled(signal)
          try {
            const image = await imageObject(page, id, signal)
            const candidate = candidates.get(image?.ref)
            if (!candidate || seen.has(image.ref)) continue
            seen.add(image.ref)
            if (image.width !== candidate.width || image.height !== candidate.height) continue
            const jpeg = await imageJpeg(image, settings, signal)
            cancelled(signal)
            if (jpeg.bytes.length + 128 >= candidate.stream.contents.length) continue
            const dict = candidate.stream.dict.clone(document.context)
            // The replacement has already been color-converted by PDF.js.
            // Keep the same indirect reference, preserving every page resource
            // and all structural references to the original image object.
            dict.set(name('Width'), PDFNumber.of(jpeg.width)); dict.set(name('Height'), PDFNumber.of(jpeg.height))
            dict.set(name('ColorSpace'), name('DeviceRGB')); dict.set(name('BitsPerComponent'), PDFNumber.of(8))
            dict.set(name('Filter'), name('DCTDecode'))
            for (const key of ['DecodeParms', 'Decode', 'Length', 'DL', 'F', 'FFilter', 'FDecodeParms']) dict.delete(name(key))
            document.context.assign(candidate.ref, PDFRawStream.of(dict, jpeg.bytes))
            stats.imagesOptimized++
            stats.imageBytesSaved += candidate.stream.contents.length - jpeg.bytes.length
          } catch (error) { cancelled(signal); stats.imageFailures++ }
          await tick()
        }
      } catch (error) { cancelled(signal); stats.pagesWithImageErrors++ }
      finally { page.cleanup() }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await task.destroy().catch(() => {})
  }
}

async function optimizeStreams(context, stats, progress, signal) {
  const streams = context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream)
  const hashes = new Map(), aliases = new Map()
  for (const [index, [ref, original]] of streams.entries()) {
    cancelled(signal)
    if (index % 10 === 0) { progress(76 + Math.round(index / Math.max(1, streams.length) * 16), 'Optimizing PDF streams and shared resources'); await tick() }
    let stream = original
    const filter = original.dict.lookup(name('Filter'))
    // Recompress the filtered bytes, retaining DecodeParms (including PNG/TIFF
    // predictors). Never interpret or rewrite content operators or font data.
    const flate = filter === name('FlateDecode') || filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === name('FlateDecode')
    if ((!filter || flate) && original.contents.length > 128 && original.contents.length < 64 * 1024 * 1024 && !original.dict.has(name('F'))) {
      try {
        const raw = flate ? await transformBytes(original.contents, true, signal) : original.contents
        const compressed = await transformBytes(raw, false, signal)
        if (compressed.length + (filter ? 0 : 24) < original.contents.length) {
          const dict = original.dict.clone(context)
          if (!filter) { dict.set(name('Filter'), name('FlateDecode')); dict.delete(name('DecodeParms')) }
          dict.delete(name('Length'))
          stream = PDFRawStream.of(dict, compressed)
          context.assign(ref, stream)
          stats.streamsOptimized++
        }
      } catch (error) { cancelled(signal) /* Unsupported/oversized streams stay intact. */ }
    }
    if (globalThis.crypto?.subtle && !stream.dict.has(name('F'))) {
      const digest = await crypto.subtle.digest('SHA-256', stream.contents)
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const signature = stream.dict.entries().filter(([key]) => key !== name('Length')).map(([key, value]) => `${key} ${value}`).sort().join('\n')
      const key = `${signature}\n${hash}`
      if (hashes.has(key)) { aliases.set(ref.toString(), hashes.get(key)); stats.duplicatesRemoved++ }
      else hashes.set(key, ref)
    }
  }
  stats.unusedObjectsRemoved += await pruneUnused(context, signal, aliases)
}

export async function compressPdfDetailed(file, options = {}) {
  const { mode = 'balanced', signal, onProgress = () => {} } = options
  if (!COMPRESSION_PRESETS[mode]) throw new Error('Choose a valid compression mode.')
  const settings = mode === 'custom' ? { quality: Number(options.quality) / 100, maxEdge: Number(options.maxEdge) } : COMPRESSION_PRESETS[mode]
  if (mode !== 'lossless' && (!Number.isFinite(settings.quality) || settings.quality < .2 || settings.quality > 1 || !Number.isInteger(settings.maxEdge) || settings.maxEdge < 600 || settings.maxEdge > 6000)) throw new Error('Choose image quality from 20 to 100 and resolution from 600 to 6000 pixels.')
  const progress = (value, label) => { cancelled(signal); onProgress(value, label) }
  progress(2, 'Reading your PDF')
  const bytes = await loadPdfBytes(file)
  cancelled(signal)
  let document
  try { document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false, throwOnInvalidObject: true }) }
  catch (error) {
    if (/encrypt/i.test(error.message || '')) throw new Error('This PDF is password-protected. Save an unlocked copy with Remove Password, then compress it.')
    throw new Error('Could not read this PDF. Choose a valid, undamaged PDF file.')
  }
  const stats = { pages: document.getPageCount(), imageCount: 0, imagesOptimized: 0, imagesRetained: 0, imageFailures: 0, pagesWithImageErrors: 0, imageBytesSaved: 0, streamsOptimized: 0, duplicatesRemoved: 0, unusedObjectsRemoved: 0 }
  if (!stats.pages) throw new Error('This PDF has no pages to compress.')
  const original = new Blob([bytes], { type: 'application/pdf' })
  const result = (blob, reason) => ({ blob, reason, stats, originalSize: bytes.length, compressedSize: blob.size, savedBytes: bytes.length - blob.size, savings: (1 - blob.size / bytes.length) * 100 })
  // Rewriting a certificate signature invalidates it. Leave signed files byte
  // for byte intact rather than silently breaking their verification.
  const signed = await hasDigitalSignature(document.context, signal)
  if (signed) { progress(100, 'Original retained to preserve its digital signature'); return result(original, 'signed') }
  stats.unusedObjectsRemoved = await pruneUnused(document.context, signal)
  stats.imageCount = document.context.enumerateIndirectObjects().filter(([, object]) => isImage(object)).length
  progress(10, 'Analyzing embedded images')
  if (mode !== 'lossless') {
    try { await optimizeImages(bytes, document, settings, stats, progress, signal) }
    catch (error) { cancelled(signal); stats.pagesWithImageErrors++ }
  }
  stats.imagesRetained = stats.imageCount - stats.imagesOptimized
  await optimizeStreams(document.context, stats, progress, signal)
  progress(94, 'Saving text, links, forms, and optimized images')
  const output = await document.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false, objectsPerTick: 30 })
  cancelled(signal)
  const smaller = output.length < bytes.length
  progress(100, smaller ? 'Compression complete' : 'This PDF is already compact')
  return result(smaller ? new Blob([output], { type: 'application/pdf' }) : original, smaller ? 'compressed' : 'already-optimized')
}
