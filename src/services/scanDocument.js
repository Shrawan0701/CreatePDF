export const SCAN_DEFAULTS = { rotation: 0, brightness: 100, contrast: 100, crop: 0 }
export const SCAN_PAPER = { a4: [595.28, 841.89], letter: [612, 792] }

export function scanDimensions(width, height, item) {
  const cropX = Math.round(width * item.crop / 100)
  const cropY = Math.round(height * item.crop / 100)
  const sourceWidth = Math.max(1, width - cropX * 2)
  const sourceHeight = Math.max(1, height - cropY * 2)
  const sideways = Math.abs(item.rotation % 180) === 90
  return { cropX, cropY, sourceWidth, sourceHeight, width: sideways ? sourceHeight : sourceWidth, height: sideways ? sourceWidth : sourceHeight }
}

export function scanLayout(width, height, options) {
  let [pageWidth, pageHeight] = SCAN_PAPER[options.paper] || [width * .75, height * .75]
  const imageSize = options.paper === 'image'
  if (!imageSize && (options.orientation === 'landscape' || (options.orientation === 'auto' && width > height))) {
    ;[pageWidth, pageHeight] = [pageHeight, pageWidth]
  }
  if (imageSize) {
    const limit = Math.min(1, 14400 / Math.max(pageWidth, pageHeight))
    pageWidth *= limit; pageHeight *= limit
  }
  const margin = imageSize ? 0 : Number(options.margin)
  const availableWidth = pageWidth - margin * 2
  const availableHeight = pageHeight - margin * 2
  const scale = !imageSize && options.fit === 'fill'
    ? Math.max(availableWidth / width, availableHeight / height)
    : Math.min(availableWidth / width, availableHeight / height)
  return { pageWidth, pageHeight, margin, availableWidth, availableHeight, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2, width: width * scale, height: height * scale }
}

export async function renderScanImage(item, maxDimension = 4096) {
  let image
  try { image = await createImageBitmap(item.file, { imageOrientation: 'from-image' }) }
  catch { throw new Error(`Cannot read “${item.file.name}”. Try a JPG, PNG or WebP image.`) }
  const canvas = document.createElement('canvas')
  try {
    const dimensions = scanDimensions(image.width, image.height, item)
    const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height))
    canvas.width = Math.max(1, Math.round(dimensions.width * scale))
    canvas.height = Math.max(1, Math.round(dimensions.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to prepare the scanned page.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.translate(canvas.width / 2, canvas.height / 2)
    context.scale(canvas.width / dimensions.width, canvas.height / dimensions.height)
    context.rotate(item.rotation * Math.PI / 180)
    context.filter = `brightness(${item.brightness}%) contrast(${item.contrast}%)`
    context.drawImage(image, dimensions.cropX, dimensions.cropY, dimensions.sourceWidth, dimensions.sourceHeight, -dimensions.sourceWidth / 2, -dimensions.sourceHeight / 2, dimensions.sourceWidth, dimensions.sourceHeight)
    return canvas
  } finally { image.close() }
}

export async function createScannedPdf(pages, options, onProgress) {
  if (!pages.length) throw new Error('Add at least one document page.')
  const { PDFDocument, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle('Scanned document')
  for (const [index, item] of pages.entries()) {
    const canvas = await renderScanImage(item)
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Unable to encode page ${index + 1}.`)), 'image/jpeg', .94))
      const image = await pdf.embedJpg(await blob.arrayBuffer())
      const dimensions = scanDimensions(item.width, item.height, item)
      const layout = scanLayout(dimensions.width, dimensions.height, options)
      const page = pdf.addPage([layout.pageWidth, layout.pageHeight])
      page.pushOperators(pushGraphicsState(), rectangle(layout.margin, layout.margin, layout.availableWidth, layout.availableHeight), clip(), endPath())
      page.drawImage(image, { x: layout.x, y: layout.y, width: layout.width, height: layout.height })
      page.pushOperators(popGraphicsState())
      onProgress?.(Math.round((index + 1) / pages.length * 95))
    } finally { canvas.width = canvas.height = 1 }
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}
