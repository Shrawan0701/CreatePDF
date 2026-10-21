import { blankBoard, normalizeBoard, normalizeBoardAction } from '../../shared/whiteboard.js'
import { getPdfLib } from './pdfEngine'

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
  const configured = import.meta.env.VITE_WHITEBOARD_URL || import.meta.env.VITE_SIGNALING_URL
  let endpoint = configured || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/whiteboard-signal`
  if (configured && /\/signal\/?$/.test(endpoint)) endpoint = endpoint.replace(/\/signal\/?$/, '/whiteboard-signal')
  let socket, closed = false, ready = false, timer
  const close = () => { closed = true; clearTimeout(timer); socket?.close() }
  const send = payload => {
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('The room connection is closed. Rejoin or continue locally.')
    socket.send(JSON.stringify(payload))
  }
  return {
    open(request) {
      try {
        socket = new WebSocket(endpoint)
        timer = setTimeout(() => { if (!ready && !closed) { onError('Room service did not respond. Restart the local dev server or check the room relay.'); close() } }, 10000)
        socket.onopen = () => { if (closed) return; try { send(request) } catch (error) { onError(error.message); close() } }
        socket.onmessage = event => {
          if (closed) return
          try {
            const message = JSON.parse(event.data)
            if (message.type === 'ready') { ready = true; clearTimeout(timer) }
            if (message.type === 'error' && !ready) { onError(message.message); close(); return }
            onMessage(message)
          } catch (error) { onError(error.message || 'Room data could not be read.'); close() }
        }
        socket.onerror = () => { if (!closed) { clearTimeout(timer); onError('Room service is unavailable. Your board is kept on this device.'); close() } }
        socket.onclose = () => { clearTimeout(timer); if (!closed) { closed = true; onDisconnect(ready) } }
      } catch (error) { onError(error.message || 'This browser could not open a room.'); close() }
    },
    send,
    close,
  }
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
    pdf.setTitle(title || 'Whiteboard'); pdf.setCreator('CreatePDF.si')
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    const wide = board.width >= board.height, page = pdf.addPage(wide ? [841.89, 595.28] : [595.28, 841.89])
    const scale = Math.min((page.getWidth() - 48) / board.width, (page.getHeight() - 48) / board.height)
    const width = board.width * scale, height = board.height * scale
    page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height })
    return new Blob([await pdf.save()], { type: 'application/pdf' })
  } finally { canvas.width = canvas.height = 0 }
}

export { blankBoard, normalizeBoard, normalizeBoardAction }
