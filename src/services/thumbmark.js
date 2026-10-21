import { processThumbmarkPixels } from './thumbmarkPixels'

const check = signal => { if (signal?.aborted) throw new DOMException('Image processing cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

export function thumbmarkDefaults() {
  return { crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, flipX: false, flipY: false, removeBackground: true, cleanup: 18, softness: 45, strength: 100, evenLighting: false, invert: false, colorMode: 'original', ink: '#173f78', trim: true, background: 'white' }
}

export async function readThumbmarkImage(file, signal) {
  if (!/^image\/(png|jpeg|webp|bmp)$/i.test(file.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, WebP or BMP image.')
  const url = URL.createObjectURL(file), image = new Image()
  let canvas
  try {
    image.src = url; await image.decode(); check(signal)
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image is empty.')
    // Browser decoding honours EXIF orientation. Retain much more detail than
    // the old 700px export while bounding working memory on phone photographs.
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(16_000_000 / (image.naturalWidth * image.naturalHeight)))
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    check(signal)
    return { file, canvas, width: canvas.width, height: canvas.height, originalWidth: image.naturalWidth, originalHeight: image.naturalHeight, scaled: scale < 1 }
  } catch (error) { if (canvas) canvas.width = canvas.height = 0; throw error }
  finally { URL.revokeObjectURL(url) }
}

export function orientThumbmark(source, options, maxEdge = 1400) {
  const sideways = options.rotation % 180 !== 0
  const width = sideways ? source.height : source.width, height = sideways ? source.width : source.height
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d'); context.translate(canvas.width / 2, canvas.height / 2)
  context.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1); context.rotate(options.rotation * Math.PI / 180)
  context.drawImage(source.canvas, -source.width * scale / 2, -source.height * scale / 2, source.width * scale, source.height * scale)
  return canvas
}

async function runPixels(frame, options, signal) {
  check(signal)
  const context = frame.getContext('2d'), pixels = context.getImageData(0, 0, frame.width, frame.height)
  if (typeof Worker === 'undefined') { await tick(); check(signal); return processThumbmarkPixels({ data: pixels.data, width: frame.width, height: frame.height, options }) }
  let worker
  try { worker = new Worker(new URL('./thumbmark.worker.js', import.meta.url), { type: 'module' }) }
  catch { await tick(); check(signal); return processThumbmarkPixels({ data: pixels.data, width: frame.width, height: frame.height, options }) }
  return await new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Image processing cancelled.', 'AbortError')) }
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate() }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data) }
    worker.onerror = () => {
      cleanup()
      // A browser may block module workers. The same pixel algorithm can still
      // run locally using a fresh copy of the unchanged source frame.
      tick().then(() => {
        check(signal)
        resolve(processThumbmarkPixels({ data: context.getImageData(0, 0, frame.width, frame.height).data, width: frame.width, height: frame.height, options }))
      }).catch(reject)
    }
    try { check(signal); worker.postMessage({ data: pixels.data, width: frame.width, height: frame.height, options }, [pixels.data.buffer]) }
    catch (error) { cleanup(); reject(error) }
  })
}

export async function renderThumbmark(source, options, { signal, maxEdge = 1400 } = {}) {
  check(signal)
  const sideways = options.rotation % 180 !== 0, crop = options.crop
  const orientedWidth = sideways ? source.height : source.width, orientedHeight = sideways ? source.width : source.height
  const left = Math.min(orientedWidth - 1, Math.max(0, Math.round(crop.x * orientedWidth))), top = Math.min(orientedHeight - 1, Math.max(0, Math.round(crop.y * orientedHeight)))
  const nativeWidth = Math.max(1, Math.min(orientedWidth - left, Math.round(crop.width * orientedWidth))), nativeHeight = Math.max(1, Math.min(orientedHeight - top, Math.round(crop.height * orientedHeight)))
  const scale = Math.min(1, maxEdge / Math.max(nativeWidth, nativeHeight))
  const width = Math.max(1, Math.round(nativeWidth * scale)), height = Math.max(1, Math.round(nativeHeight * scale))
  const frame = document.createElement('canvas'); frame.width = width; frame.height = height
  // Crop at source resolution before reducing the preview. Small crops retain
  // their ridge detail instead of inheriting a downsampled whole photograph.
  const context = frame.getContext('2d'), scaleX = width / nativeWidth, scaleY = height / nativeHeight
  context.save(); context.translate((orientedWidth / 2 - left) * scaleX, (orientedHeight / 2 - top) * scaleY)
  context.scale(scaleX * (options.flipX ? -1 : 1), scaleY * (options.flipY ? -1 : 1)); context.rotate(options.rotation * Math.PI / 180)
  context.drawImage(source.canvas, -source.width / 2, -source.height / 2); context.restore()
  try {
    const result = await runPixels(frame, options, signal)
    check(signal)
    frame.getContext('2d').putImageData(new ImageData(result.data, width, height), 0, 0)
    let bounds = { x: 0, y: 0, width, height }
    if (result.bounds) {
      const padding = Math.max(2, Math.round(Math.min(width, height) * .015))
      const x = Math.max(0, result.bounds.x - padding), y = Math.max(0, result.bounds.y - padding)
      bounds = { x, y, width: Math.min(width, result.bounds.x + result.bounds.width + padding) - x, height: Math.min(height, result.bounds.y + result.bounds.height + padding) - y }
    }
    const outputBounds = options.trim && result.bounds ? bounds : { x: 0, y: 0, width, height }
    const output = document.createElement('canvas'); output.width = outputBounds.width; output.height = outputBounds.height
    const context = output.getContext('2d')
    if (options.background !== 'transparent') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height) }
    context.drawImage(frame, outputBounds.x, outputBounds.y, outputBounds.width, outputBounds.height, 0, 0, output.width, output.height)
    return { canvas: output, width: output.width, height: output.height, empty: !result.visible, bounds: result.bounds ? { x: bounds.x / width, y: bounds.y / height, width: bounds.width / width, height: bounds.height / height } : null }
  } finally { frame.width = frame.height = 0 }
}

export async function thumbmarkPng(canvas, background = 'white') {
  // Bake white into the exported pixels; a white CSS preview alone leaves
  // transparent PNGs looking dark in image viewers with dark backgrounds.
  let output = canvas
  try {
    if (background !== 'transparent') {
      output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height
      const context = output.getContext('2d')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height)
      context.drawImage(canvas, 0, 0)
    }
    return await new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create this PNG.')), 'image/png'))
  } finally { if (output !== canvas) output.width = output.height = 0 }
}

export async function thumbmarkPdf(canvas, widthMm, background = 'white') {
  const width = Number(widthMm)
  if (!Number.isFinite(width) || width < 10 || width > 60) throw new Error('Set PDF width between 10 and 60 mm.')
  const { PDFDocument } = await import('pdf-lib'), pdf = await PDFDocument.create()
  const image = await pdf.embedPng(await (await thumbmarkPng(canvas, background)).arrayBuffer())
  const pageWidth = width * 72 / 25.4, pageHeight = pageWidth * canvas.height / canvas.width
  if (pageHeight > 14400) throw new Error('This crop is too tall for PDF export. Crop more closely or download PNG.')
  const page = pdf.addPage([pageWidth, pageHeight]); page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })
  pdf.setTitle('Thumbmark'); pdf.setCreator('CreatePDF.si')
  return new Blob([await pdf.save({ useObjectStreams: true })], { type: 'application/pdf' })
}
