import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Crop, LoaderCircle } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function CropResizePreview({ source, placement, pageNumber, onPage, view, cropping, edges, onCrop, disabled }) {
  const viewportRef = useRef(null), frameRef = useRef(null), canvasRef = useRef(null), drag = useRef(null)
  const [loaded, setLoaded] = useState(null), [rendered, setRendered] = useState(null), [failure, setFailure] = useState(null)
  const [bounds, setBounds] = useState({ width: 500, height: 600 }), [zoom, setZoom] = useState('fit')
  const pdf = loaded?.source === source ? loaded.pdf : null
  // Crop handles only change the overlay. They never restart the source-page render.
  const output = view === 'result' ? placement : null
  const invalidOutput = !!source && view === 'result' && !placement
  const ready = rendered?.pdf === pdf && rendered?.pageNumber === pageNumber && rendered?.bounds === bounds && rendered?.output === output && rendered?.zoom === zoom
  const error = failure?.source === source && (failure.load || failure.pageNumber === pageNumber && failure.output === output) ? failure.message : ''
  const editable = ready && !disabled && cropping && view === 'crop' && placement?.included
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width), height = Math.floor(entry.contentRect.height)
      if (width > 0 && height > 0) setBounds(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setLoaded(null); setRendered(null); setFailure(null); drag.current = null
    if (!source) return
    let disposed = false, task
    const open = async () => {
      const pdfjs = await getPdfjsLib()
      if (disposed) return
      task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false })
      const document = await task.promise
      if (!disposed) setLoaded({ source, pdf: document })
    }
    open().catch(failure => { if (!disposed) setFailure({ source, load: true, message: failure.message || 'Could not load this preview.' }) })
    return () => { disposed = true; task?.destroy().catch(() => {}) }
  }, [source])
  useEffect(() => {
    drag.current = null
    if (!pdf || invalidOutput) return
    let disposed = false, task
    const draw = async () => {
      setFailure(null)
      const page = await pdf.getPage(pageNumber)
      if (disposed) return
      const native = page.getViewport({ scale: 1 }), width = output?.width || native.width, height = output?.height || native.height
      const scale = zoom === 'fit' ? Math.max(Number.EPSILON, Math.min((bounds.width - 2) / width, (bounds.height - 2) / height)) : Number(zoom)
      const requestedPixels = scale * Math.min(window.devicePixelRatio || 1, 2)
      const pixelScale = requestedPixels * Math.min(1, 8192 / (Math.max(width, height) * requestedPixels), Math.sqrt(16000000 / (width * height * requestedPixels * requestedPixels)))
      const sheet = document.createElement('canvas')
      sheet.width = Math.max(1, Math.ceil(width * pixelScale)); sheet.height = Math.max(1, Math.ceil(height * pixelScale))
      const context = sheet.getContext('2d')
      context.fillStyle = '#fff'; context.fillRect(0, 0, sheet.width, sheet.height)
      let sourceScale = pixelScale * (output?.content.scale || 1)
      const fullWidth = native.width * sourceScale, fullHeight = native.height * sourceScale
      sourceScale *= Math.min(1, 8192 / Math.max(fullWidth, fullHeight), Math.sqrt(16000000 / (fullWidth * fullHeight)))
      const viewport = page.getViewport({ scale: sourceScale }), tile = document.createElement('canvas')
      tile.width = Math.max(1, Math.ceil(viewport.width)); tile.height = Math.max(1, Math.ceil(viewport.height))
      task = page.render({ canvasContext: tile.getContext('2d'), viewport })
      await task.promise
      if (disposed) return
      if (output) {
        const crop = output.insets, content = output.content, margin = output.margin * pixelScale
        context.save(); context.beginPath(); context.rect(margin, margin, width * pixelScale - margin * 2, height * pixelScale - margin * 2); context.clip()
        context.drawImage(tile, crop.left * tile.width, crop.top * tile.height, (1 - crop.left - crop.right) * tile.width, (1 - crop.top - crop.bottom) * tile.height, content.x * pixelScale, content.y * pixelScale, content.width * pixelScale, content.height * pixelScale)
        context.restore()
      } else context.drawImage(tile, 0, 0, sheet.width, sheet.height)
      tile.width = 0; tile.height = 0
      const canvas = canvasRef.current
      canvas.width = sheet.width; canvas.height = sheet.height
      canvas.style.width = `${width * scale}px`; canvas.style.height = `${height * scale}px`
      canvas.getContext('2d').drawImage(sheet, 0, 0)
      setRendered({ pdf, pageNumber, bounds, output, zoom, width: width * scale, height: height * scale })
    }
    draw().catch(failure => { if (!disposed) setFailure({ source, pageNumber, output, message: failure.message || 'Could not render this page.' }) })
    return () => { disposed = true; task?.cancel() }
  }, [source, pdf, pageNumber, bounds, output, zoom, invalidOutput])

  const adjusted = (original, direction, dx, dy) => {
    let { left, top, right, bottom } = original
    if (direction === 'move') {
      const x = clamp(dx, -left, right), y = clamp(dy, -top, bottom)
      left += x; right -= x; top += y; bottom -= y
    } else {
      if (direction.includes('w')) left = clamp(left + dx, 0, 1 - right - .02)
      if (direction.includes('e')) right = clamp(right - dx, 0, 1 - left - .02)
      if (direction.includes('n')) top = clamp(top + dy, 0, 1 - bottom - .02)
      if (direction.includes('s')) bottom = clamp(bottom - dy, 0, 1 - top - .02)
    }
    return { left, top, right, bottom }
  }
  const start = (event, direction) => {
    if (!editable) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { direction, edges: { ...edges }, x: event.clientX, y: event.clientY, bounds: frameRef.current.getBoundingClientRect(), pointer: event.pointerId }
  }
  const move = event => {
    const current = drag.current
    if (!editable || !current || current.pointer !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    onCrop(adjusted(current.edges, current.direction, (event.clientX - current.x) / current.bounds.width, (event.clientY - current.y) / current.bounds.height))
  }
  const end = event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null }
  const keyboard = (event, direction) => {
    if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? .05 : .005
    onCrop(adjusted(edges, direction, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
  }
  const showFrame = !!pdf && rendered?.pdf === pdf && !invalidOutput
  return <section className="tool-panel crop-page-preview">
    <div className="crop-preview-toolbar"><div><button className="btn btn-secondary btn-icon btn-sm" disabled={!source || pageNumber <= 1} aria-label="Previous page" onClick={() => onPage(pageNumber - 1)}><ChevronLeft size={15} /></button><span>Page</span><select className="form-select crop-page-picker" aria-label="Preview page" value={pageNumber} disabled={!source} onChange={event => onPage(Number(event.target.value))}>{Array.from({ length: source?.pageCount || 1 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select><span>of {source?.pageCount || 0}</span><button className="btn btn-secondary btn-icon btn-sm" disabled={!source || pageNumber >= source.pageCount} aria-label="Next page" onClick={() => onPage(pageNumber + 1)}><ChevronRight size={15} /></button></div><select className="form-select crop-zoom" aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit page</option><option value={4 / 3}>100%</option><option value={2}>150%</option></select></div>
    <div className="crop-viewport-wrapper"><div ref={viewportRef} className="crop-page-viewport" tabIndex={0} role="region" aria-label="Crop and resize preview" aria-busy={!!source && !ready && !error && !invalidOutput}>
      <div ref={frameRef} className="crop-page-frame" hidden={!showFrame} style={showFrame ? { width: rendered.width, height: rendered.height } : undefined}>
        <canvas ref={canvasRef} role="img" aria-label={`PDF page ${pageNumber}`} />
        {editable && <div className="crop-selection" role="group" aria-label="Selected crop area" style={{ left: `${edges.left * 100}%`, top: `${edges.top * 100}%`, width: `${(1 - edges.left - edges.right) * 100}%`, height: `${(1 - edges.top - edges.bottom) * 100}%` }}>
          <button className="crop-selection-move" aria-label="Move crop area with arrow keys or drag" onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={event => keyboard(event, 'move')} />
          {directions.map(direction => <button key={direction} className={`crop-handle ${direction}`} aria-label={`Adjust ${({ nw: 'top left', n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left' })[direction]} crop edge`} onPointerDown={event => start(event, direction)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={event => keyboard(event, direction)} />)}
        </div>}
      </div>
      {!source || error || invalidOutput ? <div className="crop-preview-empty"><Crop size={36} /><span>{error || (invalidOutput ? 'Check the settings to preview the result' : 'Choose a PDF to preview')}</span></div> : null}
    </div>{source && !ready && !error && !invalidOutput && <div className="crop-preview-loading" role="status"><LoaderCircle size={17} className="crop-spin" /> Updating preview…</div>}</div>
    <div className="crop-preview-caption">{placement && !placement.included ? 'This page is unchanged' : invalidOutput ? 'Check the settings' : view === 'crop' && cropping ? 'Drag the corners or edges to crop' : view === 'result' ? 'Live output preview' : 'Original page'}</div>
  </section>
}
