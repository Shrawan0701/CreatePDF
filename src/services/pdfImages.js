import { getPdfjsLib, loadPdfBytes } from './pdfEngine'

export function imagePageNumbers(range, count) {
  if (!range.trim()) return Array.from({ length: count }, (_, index) => index + 1)
  const pages = new Set()
  for (const token of range.split(',')) {
    if (!/^\s*\d+(?:\s*-\s*\d+)?\s*$/.test(token)) throw new Error('Enter pages such as 1-3, 5.')
    const [first, last = first] = token.trim().split('-').map(Number)
    if (first < 1 || last < first || last > count) throw new Error(`Choose pages between 1 and ${count}.`)
    for (let number = first; number <= last; number++) pages.add(number)
  }
  return [...pages].sort((a, b) => a - b)
}

// PDF.js supplies decoded RGB/RGBA or row-padded, packed monochrome pixels.
// Inferring a channel count from data.length corrupts 1-bit scanned images.
export function decodedImagePixels(image, mask = false) {
  const { width, height, data, kind } = image
  const pixels = new Uint8ClampedArray(width * height * 4)
  if (!data) throw new Error('The embedded image could not be decoded.')
  if (mask || kind === 1) {
    const stride = Math.ceil(width / 8)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1
        const offset = (y * width + x) * 4
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = mask ? 0 : bit * 255
        pixels[offset + 3] = mask ? (bit ? 0 : 255) : 255
      }
    }
  } else if (kind === 3 || data.length === width * height * 4) pixels.set(data)
  else if (kind === 2 || data.length === width * height * 3) {
    for (let pixel = 0; pixel < width * height; pixel++) {
      pixels[pixel * 4] = data[pixel * 3]
      pixels[pixel * 4 + 1] = data[pixel * 3 + 1]
      pixels[pixel * 4 + 2] = data[pixel * 3 + 2]
      pixels[pixel * 4 + 3] = 255
    }
  } else throw new Error('Unsupported decoded image format.')
  return pixels
}

function imageCanvas(image, mask, color) {
  if (!(image?.width > 0 && image?.height > 0)) throw new Error('This embedded image has no pixel data.')
  if (image.width * image.height > 64_000_000) throw new Error('An image exceeds the 64 megapixel extraction limit.')
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  try {
    if (image.bitmap) context.drawImage(image.bitmap, 0, 0)
    else context.putImageData(new ImageData(decodedImagePixels(image, mask), image.width, image.height), 0, 0)
    if (mask) {
      context.globalCompositeOperation = 'source-in'
      context.fillStyle = color
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    return canvas
  } catch (error) { canvas.width = canvas.height = 0; throw error }
}

function canvasBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), mime, quality))
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('Extraction cancelled.', 'AbortError')
}

function pdfObject(page, name, signal) {
  const objects = name.startsWith('g_') ? page.commonObjs : page.objs
  if (objects.has(name)) return Promise.resolve(objects.get(name))
  // A damaged PDF must not leave extraction waiting forever for a missing object.
  return new Promise((resolve, reject) => {
    const finish = (error, image) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve(image)
    }
    const cancel = () => finish(new DOMException('Extraction cancelled.', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('An embedded image did not finish decoding.')), 15000)
    signal?.addEventListener('abort', cancel, { once: true })
    objects.get(name, image => finish(null, image))
    if (signal?.aborted) cancel()
  })
}

export function filterPdfImages(images, { deduplicate = true, minSize = 0, page = 'all', sort = 'page' } = {}) {
  let filtered = images.filter(image => (page === 'all' || image.pageNumber === Number(page)) && Math.min(image.width, image.height) >= Number(minSize))
  if (deduplicate) {
    const grouped = new Map()
    for (const image of filtered) {
      const key = image.hash || image.id
      const existing = grouped.get(key)
      if (existing) existing.pageNumbers = [...new Set([...existing.pageNumbers, image.pageNumber])]
      else grouped.set(key, { ...image, pageNumbers: [image.pageNumber] })
    }
    filtered = [...grouped.values()]
  }
  if (sort === 'largest') filtered.sort((a, b) => b.width * b.height - a.width * a.height)
  if (sort === 'size') filtered.sort((a, b) => b.blob.size - a.blob.size)
  return filtered
}

export async function extractPdfImages(file, options = {}, onProgress = () => {}) {
  const { signal } = options
  checkCancelled(signal)
  const pdfjs = await getPdfjsLib()
  const data = await loadPdfBytes(file)
  checkCancelled(signal)
  // Keep native pixel dimensions and let PDF.js decode color spaces and soft masks.
  const task = pdfjs.getDocument({ data, password: options.password || undefined, isOffscreenCanvasSupported: false })
  const cancel = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  const images = [], warnings = []
  try {
    const pdf = await task.promise
    const pages = imagePageNumbers(options.pageRange || '', pdf.numPages)
    for (const [pageIndex, pageNumber] of pages.entries()) {
      checkCancelled(signal)
      onProgress(Math.round(pageIndex / pages.length * 100), `Reading page ${pageNumber} of ${pdf.numPages}`)
      const page = await pdf.getPage(pageNumber)
      try {
        const operators = await page.getOperatorList()
        const seen = new Set(), stack = []
        let fillColor = '#000000', pageImageCount = 0
        for (let index = 0; index < operators.fnArray.length; index++) {
          checkCancelled(signal)
          const op = operators.fnArray[index], args = operators.argsArray[index]
          if (op === pdfjs.OPS.save) { stack.push(fillColor); continue }
          if (op === pdfjs.OPS.restore) { fillColor = stack.pop() || '#000000'; continue }
          if (op === pdfjs.OPS.setFillRGBColor) { fillColor = args[0]; continue }
          if (op === pdfjs.OPS.setFillTransparent) { fillColor = 'transparent'; continue }
          let candidates = []
          if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintImageXObjectRepeat].includes(op)) candidates = [{ objectName: args[0] }]
          else if (op === pdfjs.OPS.paintInlineImageXObject) candidates = [{ image: args[0] }]
          else if (op === pdfjs.OPS.paintInlineImageXObjectGroup) candidates = args[1].map(crop => ({ image: args[0], crop }))
          else if ([pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectRepeat].includes(op)) candidates = [{ image: args[0], mask: true }]
          else if (op === pdfjs.OPS.paintImageMaskXObjectGroup) candidates = args[0].map(image => ({ image, mask: true }))
          for (const [candidateIndex, candidate] of candidates.entries()) {
            let canvas, cropped
            try {
              const objectName = candidate.objectName || (typeof candidate.image?.data === 'string' ? candidate.image.data : null)
              const key = objectName ? `${objectName}-${candidate.mask ? fillColor : ''}` : `${index}-${candidateIndex}`
              if (seen.has(key)) continue
              seen.add(key)
              const image = objectName ? await pdfObject(page, objectName, signal) : candidate.image
              checkCancelled(signal)
              canvas = imageCanvas(image, candidate.mask, fillColor)
              if (candidate.crop) {
                const { x, y, w, h } = candidate.crop
                cropped = document.createElement('canvas'); cropped.width = w; cropped.height = h
                cropped.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h)
              }
              const output = cropped || canvas
              const blob = await canvasBlob(output)
              checkCancelled(signal)
              const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
              const id = `page-${pageNumber}-image-${++pageImageCount}`
              images.push({ id, name: `${id}.png`, blob, width: output.width, height: output.height, pageNumber, hash, mask: !!candidate.mask })
            } catch (error) {
              checkCancelled(signal)
              warnings.push(`Page ${pageNumber}: ${error.message}`)
            } finally {
              if (canvas) canvas.width = canvas.height = 0
              if (cropped) cropped.width = cropped.height = 0
            }
          }
        }
      } finally { page.cleanup() }
      onProgress(Math.round((pageIndex + 1) / pages.length * 100), `Read ${pageIndex + 1} of ${pages.length} pages`)
    }
    return { images, warnings, pageCount: pdf.numPages, pagesProcessed: pages.length }
  } catch (error) {
    checkCancelled(signal)
    if (error.name === 'PasswordException') throw new Error('This PDF needs a password. Enter its opening password and try again.')
    if (error.name === 'InvalidPDFException') throw new Error('Could not read this PDF. Choose a valid PDF document.')
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    await task.destroy()
  }
}

export async function exportPdfImage(image, format = 'png', quality = 0.92) {
  if (format === 'png') return { blob: image.blob, name: image.name }
  if (format !== 'jpg') throw new Error('Choose PNG or JPG output.')
  const bitmap = await createImageBitmap(image.blob)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    return { blob: await canvasBlob(canvas, 'image/jpeg', quality), name: image.name.replace(/\.png$/i, '.jpg') }
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}
