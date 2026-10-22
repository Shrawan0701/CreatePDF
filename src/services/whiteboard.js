import { blankBoard, normalizeBoard, normalizeBoardAction } from '../../shared/whiteboard.js'
import { getPdfLib } from './pdfEngine'
import { createRoomSession } from './whiteboardTransport'

export async function readSavedWhiteboard(record) {
  let width = record.width
  if (!width && record.image) {
    const image = new Image()
    try { image.src = record.image; await image.decode(); width = image.naturalWidth * 600 / image.naturalHeight } catch { /* Actions remain usable if an old preview is missing. */ }
  }
  return normalizeBoard({ ...record, width })
}

export function paintWhiteboard(context, board, draft = null) {
  context.clearRect(0, 0, board.width, board.height)
  const render = action => {
    if (action.hidden) return
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = action.width
    context.strokeStyle = action.color; context.fillStyle = action.color
    if (action.kind === 'erase') context.globalCompositeOperation = 'destination-out'
    if (action.kind === 'stroke' || action.kind === 'erase') {
      const points = action.points
      context.beginPath()
      if (points.length === 1) { context.arc(points[0].x, points[0].y, action.width / 2, 0, Math.PI * 2); context.fill() }
      else {
        context.moveTo(points[0].x, points[0].y)
        for (let index = 1; index < points.length - 1; index++) context.quadraticCurveTo(points[index].x, points[index].y, (points[index].x + points[index + 1].x) / 2, (points[index].y + points[index + 1].y) / 2)
        context.lineTo(points.at(-1).x, points.at(-1).y); context.stroke()
      }
    } else if (action.kind === 'text') {
      context.font = `${action.fontSize}px "Segoe UI", Arial, sans-serif`; context.textBaseline = action.baseline || 'top'
      action.text.split(/\r?\n/).forEach((line, index) => context.fillText(line, action.at.x, action.at.y + index * action.fontSize * 1.35))
    } else if (action.kind === 'rect') context.strokeRect(action.from.x, action.from.y, action.to.x - action.from.x, action.to.y - action.from.y)
    else if (action.kind === 'ellipse') {
      context.beginPath(); context.ellipse((action.from.x + action.to.x) / 2, (action.from.y + action.to.y) / 2, Math.abs(action.to.x - action.from.x) / 2, Math.abs(action.to.y - action.from.y) / 2, 0, 0, Math.PI * 2); context.stroke()
    } else if (action.kind === 'line') { context.beginPath(); context.moveTo(action.from.x, action.from.y); context.lineTo(action.to.x, action.to.y); context.stroke() }
    context.restore()
  }
  board.actions.forEach(render)
  if (draft) render(draft)
  // Export and preview share the same white background, including erased areas.
  context.save(); context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, board.width, board.height); context.restore()
}

export function createWhiteboardSession({ onMessage, onDisconnect, onError }) {
  return createRoomSession({ onMessage, onDisconnect, onError, configured: import.meta.env.VITE_WHITEBOARD_URL || import.meta.env.VITE_SIGNALING_URL, development: import.meta.env.DEV })
}

export async function exportWhiteboard(board, format, title) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(board.width); canvas.height = Math.round(board.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas export is unavailable in this browser.')
  try {
    paintWhiteboard(context, board)
    if (format === 'png') return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'))
    const { PDFDocument } = await getPdfLib(), pdf = await PDFDocument.create()
    pdf.setTitle(title || 'Whiteboard'); pdf.setCreator('CreatePDF.tech')
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    const wide = board.width >= board.height, page = pdf.addPage(wide ? [841.89, 595.28] : [595.28, 841.89])
    const scale = Math.min((page.getWidth() - 48) / board.width, (page.getHeight() - 48) / board.height)
    const width = board.width * scale, height = board.height * scale
    page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height })
    return new Blob([await pdf.save()], { type: 'application/pdf' })
  } finally { canvas.width = canvas.height = 0 }
}

export { blankBoard, normalizeBoard, normalizeBoardAction }
