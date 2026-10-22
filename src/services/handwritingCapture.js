const papers = { A4: [595.28, 841.89], Letter: [612, 792], A5: [419.53, 595.28] }
const check = signal => { if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export const CAPTURE_PAPERS = papers
export const capturePageDefaults = () => ({ rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, appearance: 'original', brightness: 0, contrast: 0, threshold: 170 })
export const captureLayoutDefaults = () => ({ size: 'A4', orientation: 'auto', margin: 10, fit: 'fit', quality: 'high' })

export async function decodeHandwritingPhoto(file, { signal, maxEdge = 1800 } = {}) {
  check(signal)
  const url = URL.createObjectURL(file), image = new Image()
  let canvas
  try {
    image.src = url; await image.decode(); check(signal)
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image is empty.')
    // Browser image decoding honours camera EXIF orientation. Exporting the
    // decoded pixels avoids applying EXIF a second time in the PDF.
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(16_000_000 / (image.naturalWidth * image.naturalHeight)))
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height)
    check(signal)
    return { canvas, width: image.naturalWidth, height: image.naturalHeight }
  } catch (error) { if (canvas) canvas.width = canvas.height = 0; throw error }
  finally { URL.revokeObjectURL(url); image.src = '' }
}

export async function readHandwritingPhoto(file, signal) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type) && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, WebP or BMP image.')
  if (file.size > 50 * 1024 * 1024) throw new Error('Use images smaller than 50 MB.')
  const decoded = await decodeHandwritingPhoto(file, { signal, maxEdge: 280 })
  try {
    return { id: crypto.randomUUID(), file, width: decoded.width, height: decoded.height, thumbnail: decoded.canvas.toDataURL('image/jpeg', .8), ...capturePageDefaults() }
  } finally { decoded.canvas.width = decoded.canvas.height = 0 }
}

export function orientHandwritingPhoto(source, page) {
  const sideways = page.rotation % 180 !== 0, canvas = document.createElement('canvas')
  canvas.width = sideways ? source.height : source.width; canvas.height = sideways ? source.width : source.height
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(page.rotation * Math.PI / 180)
  context.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

export function processHandwritingPhoto(source, page, maxEdge = 4096) {
  const sideways = page.rotation % 180 !== 0, width = sideways ? source.height : source.width, height = sideways ? source.width : source.height
  const { crop } = page
  const x = clamp(Math.round(crop.x * width), 0, width - 1), y = clamp(Math.round(crop.y * height), 0, height - 1)
  const croppedWidth = clamp(Math.round(crop.width * width), 1, width - x), croppedHeight = clamp(Math.round(crop.height * height), 1, height - y)
  const scale = Math.min(1, maxEdge / Math.max(croppedWidth, croppedHeight))
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(croppedWidth * scale)); canvas.height = Math.max(1, Math.round(croppedHeight * scale))
  try {
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.save(); context.scale(canvas.width / croppedWidth, canvas.height / croppedHeight)
    context.translate(width / 2 - x, height / 2 - y); context.rotate(page.rotation * Math.PI / 180)
    context.drawImage(source, -source.width / 2, -source.height / 2); context.restore()
    if (page.appearance === 'original' && !page.brightness && !page.contrast) return canvas
    const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data
    let black = 0, paper = 255
    if (page.appearance === 'clean') {
      const histogram = new Uint32Array(256)
      for (let offset = 0; offset < data.length; offset += 4) histogram[Math.round(data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722)]++
      const pixels = canvas.width * canvas.height; let total = 0, foundBlack = false
      for (let value = 0; value < 256; value++) { total += histogram[value]; if (!foundBlack && total >= pixels * .015) { black = value; foundBlack = true }; if (total >= pixels * .9) { paper = value; break } }
      if (paper - black < 45) { black = 0; paper = 255 }
    }
    const contrast = Math.pow(2, Number(page.contrast) / 50), brightness = Number(page.brightness) * 2.55
    const adjust = value => clamp(Math.round((value - 127.5) * contrast + 127.5 + brightness), 0, 255)
    for (let offset = 0; offset < data.length; offset += 4) {
      if (page.appearance === 'original') { data[offset] = adjust(data[offset]); data[offset + 1] = adjust(data[offset + 1]); data[offset + 2] = adjust(data[offset + 2]) }
      else {
        let value = data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722
        if (page.appearance === 'clean') value = (value - black) / (paper - black) * 255
        value = adjust(value)
        if (page.appearance === 'mono') value = value < Number(page.threshold) ? 0 : 255
        data[offset] = data[offset + 1] = data[offset + 2] = value
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  } catch (error) { canvas.width = canvas.height = 0; throw error }
}

export function handwritingPhotoLayout(page, options) {
  const sideways = page.rotation % 180 !== 0
  const imageWidth = (sideways ? page.height : page.width) * page.crop.width, imageHeight = (sideways ? page.width : page.height) * page.crop.height
  let width, height
  if (options.size === 'image') {
    const scale = Math.min(.75, 14400 / Math.max(imageWidth, imageHeight))
    width = imageWidth * scale; height = imageHeight * scale
  } else {
    [width, height] = papers[options.size] || papers.A4
    if (options.orientation === 'landscape' || (options.orientation === 'auto' && imageWidth > imageHeight)) [width, height] = [height, width]
  }
  const marginMm = options.size === 'image' ? 0 : Number(options.margin)
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 30) throw new Error('Set margins between 0 and 30 mm.')
  const margin = options.size === 'image' ? 0 : marginMm * 72 / 25.4
  const areaWidth = width - margin * 2, areaHeight = height - margin * 2
  if (areaWidth <= 0 || areaHeight <= 0) throw new Error('Reduce the page margin.')
  const scale = options.fit === 'fill' ? Math.max(areaWidth / imageWidth, areaHeight / imageHeight) : Math.min(areaWidth / imageWidth, areaHeight / imageHeight)
  const drawWidth = imageWidth * scale, drawHeight = imageHeight * scale
  return { width, height, margin, areaWidth, areaHeight, x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, drawWidth, drawHeight }
}

export function handwritingSheetPreview(image, page, options) {
  const layout = handwritingPhotoLayout(page, options), scale = Math.min(2, 1600 / Math.max(layout.width, layout.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(layout.width * scale)); canvas.height = Math.max(1, Math.ceil(layout.height * scale))
  const context = canvas.getContext('2d'); context.scale(scale, scale); context.fillStyle = '#ffffff'; context.fillRect(0, 0, layout.width, layout.height)
  context.beginPath(); context.rect(layout.margin, layout.margin, layout.areaWidth, layout.areaHeight); context.clip()
  context.drawImage(image, layout.x, layout.y, layout.drawWidth, layout.drawHeight)
  return canvas
}

function encode(canvas, type, quality) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode this page.')), type, quality)) }

export async function createHandwritingPhotoPdf(pages, options, { signal, title = 'Handwritten notes', onProgress } = {}) {
  if (!pages.length) throw new Error('Add a handwriting image first.')
  check(signal)
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib')
  const pdf = await PDFDocument.create(); pdf.setTitle(title); pdf.setCreator('CreatePDF.tech')
  const settings = options.quality === 'small' ? { dpi: 150, quality: .8, type: 'image/jpeg' } : options.quality === 'lossless' ? { dpi: 300, type: 'image/png' } : { dpi: 240, quality: .94, type: 'image/jpeg' }
  for (let index = 0; index < pages.length; index++) {
    check(signal); onProgress?.(index / pages.length * 94, `Preparing page ${index + 1} of ${pages.length}…`); await tick()
    const item = pages[index], layout = handwritingPhotoLayout(item, options)
    let decoded, image
    try {
      decoded = await decodeHandwritingPhoto(item.file, { signal, maxEdge: 4096 })
      const maxEdge = Math.min(4096, Math.ceil(Math.max(layout.drawWidth, layout.drawHeight) * settings.dpi / 72))
      image = processHandwritingPhoto(decoded.canvas, item, maxEdge); check(signal)
      const blob = await encode(image, settings.type, settings.quality); check(signal)
      const bytes = await blob.arrayBuffer(), embedded = settings.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      check(signal)
      const page = pdf.addPage([layout.width, layout.height]); page.drawRectangle({ x: 0, y: 0, width: layout.width, height: layout.height, color: rgb(1, 1, 1) })
      page.pushOperators(pushGraphicsState(), rectangle(layout.margin, layout.margin, layout.areaWidth, layout.areaHeight), clip(), endPath())
      page.drawImage(embedded, { x: layout.x, y: layout.y, width: layout.drawWidth, height: layout.drawHeight }); page.pushOperators(popGraphicsState())
    } catch (error) { if (error.name === 'AbortError') throw error; throw new Error(`Page ${index + 1} (${item.file.name}): ${error.message || 'Could not create this page.'}`) }
    finally { if (decoded) decoded.canvas.width = decoded.canvas.height = 0; if (image) image.width = image.height = 0 }
  }
  check(signal); onProgress?.(97, 'Finishing PDF…'); await tick()
  const bytes = await pdf.save({ useObjectStreams: true }); check(signal); onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
