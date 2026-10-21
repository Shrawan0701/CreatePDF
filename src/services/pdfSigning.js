import { readEditorImage } from './pdfEditor'

export const SIGNATURE_FONTS = {
  script: { label: 'Script', font: '"Segoe Script", "Brush Script MT", cursive' },
  handwritten: { label: 'Handwritten', font: '"Segoe Print", "Bradley Hand", cursive' },
  formal: { label: 'Formal', font: 'Georgia, "Times New Roman", serif', italic: true },
}

export function drawSignatureStrokes(canvas, strokes, { color = '#172b27', width = 6 } = {}) {
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = color; context.fillStyle = color
  context.lineWidth = width * canvas.width / 1000; context.lineCap = 'round'; context.lineJoin = 'round'
  for (const points of strokes) {
    if (!points.length) continue
    const mapped = points.map(point => ({ x: point.x * canvas.width, y: point.y * canvas.height }))
    if (mapped.length === 1) {
      context.beginPath(); context.arc(mapped[0].x, mapped[0].y, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); continue
    }
    context.beginPath(); context.moveTo(mapped[0].x, mapped[0].y)
    for (let index = 1; index < mapped.length; index++) {
      const previous = mapped[index - 1], next = mapped[index]
      context.quadraticCurveTo(previous.x, previous.y, (previous.x + next.x) / 2, (previous.y + next.y) / 2)
    }
    context.lineTo(mapped.at(-1).x, mapped.at(-1).y); context.stroke()
  }
}

// Trim the blank margins so the resize box follows the actual ink.
function trimSignature(canvas, ignoreWhite = false) {
  const context = canvas.getContext('2d'), { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4
    if (pixels[offset + 3] <= 8 || (ignoreWhite && pixels[offset] > 246 && pixels[offset + 1] > 246 && pixels[offset + 2] > 246)) continue
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left) return null
  const padding = Math.max(4, Math.round(Math.min(width, height) * .025))
  left = Math.max(0, left - padding); top = Math.max(0, top - padding)
  right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding)
  const output = document.createElement('canvas')
  output.width = right - left + 1; output.height = bottom - top + 1
  output.getContext('2d').drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height)
  const result = { dataUrl: output.toDataURL('image/png'), aspect: output.width / output.height }
  output.width = output.height = 0
  return result
}

export function createDrawnSignature(strokes, options) {
  if (!strokes.length) return null
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 500
  try { drawSignatureStrokes(canvas, strokes, options); return trimSignature(canvas) }
  finally { canvas.width = canvas.height = 0 }
}

export function createTypedSignature(text, style = 'script', color = '#172b27') {
  if (!text.trim()) return null
  const settings = SIGNATURE_FONTS[style] || SIGNATURE_FONTS.script
  const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 420
  const context = canvas.getContext('2d')
  const font = size => `${settings.italic ? 'italic ' : ''}${size}px ${settings.font}`
  context.font = font(180)
  const size = Math.min(180, 180 * 1680 / Math.max(1, context.measureText(text.trim()).width))
  context.font = font(size); context.fillStyle = color; context.textBaseline = 'middle'
  context.fillText(text.trim(), 60, 210)
  try { return trimSignature(canvas) } finally { canvas.width = canvas.height = 0 }
}

export async function importSignatureImage(file, removeBackground = true, signal) {
  const check = () => { if (signal?.aborted) throw new DOMException('Image loading cancelled.', 'AbortError') }
  check()
  const decoded = await readEditorImage(file)
  check()
  const image = new Image(); image.src = decoded.dataUrl; await image.decode()
  check()
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  try {
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    if (removeBackground) {
      const frame = context.getImageData(0, 0, canvas.width, canvas.height), pixels = frame.data
      for (let index = 0; index < pixels.length; index += 4) {
        const low = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]), high = Math.max(pixels[index], pixels[index + 1], pixels[index + 2])
        // Remove neutral paper whites while retaining coloured and dark ink.
        if (low > 200 && high - low < 35) pixels[index + 3] = Math.round(pixels[index + 3] * Math.max(0, Math.min(1, (240 - low) / 40)))
      }
      context.putImageData(frame, 0, 0)
    }
    check()
    const result = trimSignature(canvas, !removeBackground)
    if (!result) throw new Error('No visible signature found in this image.')
    return result
  } finally { canvas.width = canvas.height = 0 }
}

export function signatureTargetPages(input, total) {
  const text = String(input || '').trim().toLowerCase()
  if (!text || text === 'all') return Array.from({ length: total }, (_, index) => index + 1)
  if (text === 'odd' || text === 'even') return Array.from({ length: total }, (_, index) => index + 1).filter(page => page % 2 === (text === 'odd' ? 1 : 0))
  const result = new Set()
  for (const token of text.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use page numbers such as 1-3, 5, or all, odd, even.')
    const first = Number(match[1]), last = Number(match[2] || match[1])
    if (first < 1 || last < first || last > total) throw new Error(`Pages must be between 1 and ${total}, in ascending ranges.`)
    for (let page = first; page <= last; page++) result.add(page)
  }
  return [...result].sort((a, b) => a - b)
}
