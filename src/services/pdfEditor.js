import { PDFDocument, PDFName, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath } from 'pdf-lib'
import { loadPdfBytes } from './pdfEngine'
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from './unicodePdf'

const check = signal => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const color = hex => rgb(...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255))

export function editorTextLines(text, font, size, width, unicode) {
  const lines = []
  for (const paragraph of String(text || '').replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const character of paragraph) {
      if (line && measureUnicodeText(line + character, font, size, unicode) > width) {
        const separator = line.lastIndexOf(' ')
        if (separator > 0) { lines.push(line.slice(0, separator)); line = line.slice(separator + 1) + character }
        else { lines.push(line); line = character }
      } else line += character
    }
    lines.push(line)
  }
  return lines
}

// Map displayed page coordinates (bottom-left origin) back into the original
// PDF coordinates. Keep its rotation, crop box, annotations and page reference.
function displayedPageMatrix(viewport) {
  const [a, b, c, d, e, f] = viewport.transform
  const determinant = a * d - b * c
  if (!determinant) throw new Error('This page has invalid dimensions.')
  const inverse = [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant]
  return [inverse[0], inverse[1], -inverse[2], -inverse[3], inverse[2] * viewport.height + inverse[4], inverse[3] * viewport.height + inverse[5]]
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare this image.')), 'image/png'))
}

export async function readEditorImage(file) {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPG or WebP image.')
  const url = URL.createObjectURL(file)
  const image = new Image()
  let canvas
  try {
    image.src = url
    await image.decode()
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(16_000_000 / (image.naturalWidth * image.naturalHeight)))
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height, label: file.name }
  } finally {
    URL.revokeObjectURL(url)
    if (canvas) canvas.width = canvas.height = 0
  }
}

export async function createEditedPdf(file, pdf, overlays, { signal, onProgress } = {}) {
  check(signal)
  if (!overlays.length) return file
  const document = await PDFDocument.load(await loadPdfBytes(file), { updateMetadata: false })
  check(signal)
  const families = {
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  }
  const fonts = new Map(), images = new Map()
  const textEdits = overlays.filter(item => item.type === 'text' || item.type === 'replace')
  const unicode = textEdits.some(item => /[\u0900-\u0dff\u20b9]/.test(item.text)) ? await embedUnicodeFonts(document) : {}
  const pageNumbers = [...new Set(overlays.map(item => item.page))]
  for (let index = 0; index < pageNumbers.length; index++) {
    check(signal)
    const pageNumber = pageNumbers[index]
    onProgress?.(Math.round(index / pageNumbers.length * 90), `Saving page ${pageNumber}…`)
    await tick()
    const page = document.getPage(pageNumber - 1)
    const sourcePage = await pdf.getPage(pageNumber)
    const viewport = sourcePage.getViewport({ scale: 1 })
    const { width, height } = viewport
    const items = overlays.filter(item => item.page === pageNumber)
    const replacements = items.filter(item => item.type === 'replace')
    const matrix = displayedPageMatrix(viewport)

    if (replacements.length) {
      // Only text replacement needs a flattened background. Retain the original
      // document and page objects so other pages, links and bookmarks survive.
      const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(24_000_000 / (width * height)))
      const rendered = sourcePage.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      let renderTask
      const cancelRender = () => renderTask?.cancel()
      signal?.addEventListener('abort', cancelRender, { once: true })
      try {
        canvas.width = Math.ceil(rendered.width); canvas.height = Math.ceil(rendered.height)
        const context = canvas.getContext('2d')
        // Annotations remain interactive in the original document; do not bake
        // an extra copy of their appearances into the replacement background.
        renderTask = sourcePage.render({ canvasContext: context, viewport: rendered, annotationMode: 0, background: '#ffffff' })
        await renderTask.promise
        check(signal)
        for (const item of replacements) {
          const region = item.sourceRegion
          context.fillStyle = item.backgroundColor || '#ffffff'
          context.fillRect(Math.floor(region.x * canvas.width), Math.floor(region.y * canvas.height), Math.ceil(region.width * canvas.width) + 1, Math.ceil(region.height * canvas.height) + 1)
        }
        const image = await document.embedPng(await (await canvasBlob(canvas)).arrayBuffer())
        check(signal)
        page.node.set(PDFName.of('Contents'), document.context.obj([]))
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix))
        page.drawImage(image, { x: 0, y: 0, width, height })
        page.pushOperators(popGraphicsState())
      } finally {
        signal?.removeEventListener('abort', cancelRender)
        canvas.width = canvas.height = 0
      }
    }

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix))
    for (const item of items) {
      check(signal)
      const x = item.x * width, boxWidth = item.width * width, boxHeight = item.height * height
      const y = height - item.y * height - boxHeight
      if (item.type === 'text' || item.type === 'replace') {
        const fontName = families[item.fontFamily || 'Helvetica'][Number(!!item.bold) + Number(!!item.italic) * 2]
        if (!fonts.has(fontName)) fonts.set(fontName, await document.embedFont(fontName))
        const font = fonts.get(fontName), unicodeFonts = { ...unicode, baseBold: item.bold ? font : null }
        const lines = editorTextLines(item.text, font, item.fontSize, boxWidth, unicodeFonts)
        page.pushOperators(pushGraphicsState(), rectangle(x, y, boxWidth, boxHeight), clip(), endPath())
        lines.forEach((line, lineIndex) => {
          const textWidth = measureUnicodeText(line, font, item.fontSize, unicodeFonts)
          const offset = item.align === 'center' ? (boxWidth - textWidth) / 2 : item.align === 'right' ? boxWidth - textWidth : 0
          drawUnicodeText(page, line, { x: x + Math.max(0, offset), y: height - item.y * height - item.fontSize * .95 - lineIndex * item.fontSize * 1.2, size: item.fontSize, font, color: color(item.color) }, unicodeFonts)
        })
        page.pushOperators(popGraphicsState())
      } else if (item.type === 'image') {
        if (!images.has(item.dataUrl)) images.set(item.dataUrl, await document.embedPng(item.dataUrl))
        page.drawImage(images.get(item.dataUrl), { x, y, width: boxWidth, height: boxHeight })
      } else if (item.type === 'line') {
        page.drawLine({ start: { x, y: item.reverse ? y : y + boxHeight }, end: { x: x + boxWidth, y: item.reverse ? y + boxHeight : y }, color: color(item.color), thickness: item.strokeWidth || 2, opacity: item.opacity ?? 1 })
      } else {
        page.drawRectangle({ x, y, width: boxWidth, height: boxHeight, color: item.filled ? color(item.color) : undefined, opacity: item.opacity ?? 1, borderColor: item.type === 'highlight' ? undefined : color(item.color), borderWidth: item.type === 'highlight' ? 0 : item.strokeWidth || 2, borderOpacity: item.opacity ?? 1 })
      }
    }
    page.pushOperators(popGraphicsState())
  }
  check(signal)
  onProgress?.(95, 'Finishing PDF…')
  await tick()
  const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false })
  check(signal)
  onProgress?.(100, 'PDF ready')
  return new Blob([bytes], { type: 'application/pdf' })
}
