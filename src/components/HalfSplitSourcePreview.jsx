import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, GripHorizontal, GripVertical } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

export function HalfSplitSourcePreview({ source, mode, position, overlapRatio = 0, pageNumber, splitAfter, included = true, disabled, onPage, onPosition }) {
  const viewportRef = useRef(null), canvasRef = useRef(null), frameRef = useRef(null)
  const [loaded, setLoaded] = useState(null), [failure, setFailure] = useState(null)
  const [bounds, setBounds] = useState({ width: 500, height: 550 }), [rendered, setRendered] = useState(null)
  const pdf = loaded?.source === source ? loaded.pdf : null
  const error = failure?.source === source ? failure.message : ''
  const vertical = mode === 'vertical', cutting = mode !== 'pages'
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let disposed = false, task
    const load = async () => {
      const pdfjs = await getPdfjsLib()
      if (disposed) return
      task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false })
      const pdf = await task.promise
      if (!disposed) setLoaded({ source, pdf })
    }
    load().catch(error => { if (!disposed) setFailure({ source, message: error.message }) })
    return () => { disposed = true; task?.destroy().catch(() => {}) }
  }, [source])
  useEffect(() => {
    if (!pdf) return
    let disposed = false, task
    const render = async () => {
      const page = await pdf.getPage(pageNumber)
      if (disposed) return
      const native = page.getViewport({ scale: 1 })
      const scale = Math.min(Math.max(80, bounds.width - 32) / native.width, Math.max(80, bounds.height - 32) / native.height)
      const width = native.width * scale, height = native.height * scale
      const viewport = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2) })
      const canvas = canvasRef.current
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      await task.promise
      if (!disposed) setRendered({ pdf, pageNumber, bounds, width, height })
    }
    render().catch(error => { if (!disposed) setFailure({ source, message: error.message }) })
    return () => { disposed = true; task?.cancel() }
  }, [pdf, pageNumber, bounds, source])
  const ready = rendered?.pdf === pdf && rendered.pageNumber === pageNumber && rendered.bounds === bounds
  const changePosition = event => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = frameRef.current.getBoundingClientRect()
    const value = (vertical ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height) * 100
    onPosition(Math.max(10, Math.min(90, Math.round(value))))
  }
  const keyboardPosition = event => {
    if (disabled) return
    let next
    if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = Number(position) - 1
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = Number(position) + 1
    if (event.key === 'Home') next = 10
    if (event.key === 'End') next = 90
    if (next !== undefined) { event.preventDefault(); onPosition(Math.max(10, Math.min(90, next))) }
  }
  const percent = Number.isFinite(Number(position)) ? Math.max(10, Math.min(90, Number(position))) : 50
  return <div className="tool-panel half-source-preview">
    <div className="half-preview-heading"><h3>{cutting ? 'Position the page cut' : 'Original page preview'}</h3><span>{cutting ? 'Drag the line or use the controls' : 'Check the pages around your split point'}</span></div>
    <div className="half-source-toolbar"><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous source page" disabled={pageNumber <= 1} onClick={() => onPage(pageNumber - 1)}><ChevronLeft size={15} /></button><label htmlFor="half-preview-page">Page</label><select id="half-preview-page" className="form-select" value={pageNumber} onChange={event => onPage(Number(event.target.value))}>{Array.from({ length: source.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><span>of {source.pageCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next source page" disabled={pageNumber === source.pageCount} onClick={() => onPage(pageNumber + 1)}><ChevronRight size={15} /></button></div><span className={`half-page-status${!included ? ' excluded' : ''}`}>{!included ? 'Outside selected range' : cutting ? vertical ? 'Left / right' : 'Top / bottom' : splitAfter ? pageNumber <= splitAfter ? 'First half' : 'Second half' : 'Source PDF'}</span></div>
    {error && <p className="split-warning" role="status">Page preview unavailable: {error}. You can still create the PDFs.</p>}
    <div ref={viewportRef} className="half-source-viewport" aria-busy={!ready && !error}>
      <div ref={frameRef} className="half-source-frame" style={ready ? { width: rendered.width, height: rendered.height } : undefined}>
        <canvas ref={canvasRef} hidden={!ready} role="img" aria-label={`Source PDF page ${pageNumber}`} />
        {ready && cutting && <div className={`half-cut-overlay ${vertical ? 'vertical' : 'horizontal'}${disabled ? ' disabled' : ''}`}>
          <div className="half-region-first" style={vertical ? { width: `${percent}%` } : { height: `${percent}%` }} />
          <div className="half-region-second" style={vertical ? { left: `${percent}%`, width: `${100 - percent}%` } : { top: `${percent}%`, height: `${100 - percent}%` }} />
          {overlapRatio > 0 && <div className="half-overlap-band" style={vertical ? { left: `${percent - overlapRatio * 50}%`, width: `${overlapRatio * 100}%` } : { top: `${percent - overlapRatio * 50}%`, height: `${overlapRatio * 100}%` }} />}
          <div className="half-cut-line" role="slider" aria-label="Cut position" aria-valuemin={10} aria-valuemax={90} aria-valuenow={percent} aria-valuetext={`${percent}% from the ${vertical ? 'left' : 'top'}`} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} style={vertical ? { left: `${percent}%` } : { top: `${percent}%` }} onKeyDown={keyboardPosition} onPointerDown={event => { if (!disabled) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); changePosition(event) } }} onPointerMove={changePosition} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}><span>{vertical ? <GripVertical size={16} /> : <GripHorizontal size={16} />}</span></div>
          <span className="half-overlay-first-label">{vertical ? 'LEFT' : 'TOP'}</span><span className="half-overlay-second-label">{vertical ? 'RIGHT' : 'BOTTOM'}</span>
        </div>}
      </div>
      {!ready && !error && <p className="half-preview-loading">Preparing page preview…</p>}
    </div>
    <p className="split-hint">{cutting ? 'The line follows the displayed page orientation. Each PDF keeps its side of every selected page.' : 'The selected page is shown at its original size and orientation, fitted to this preview.'}</p>
  </div>
}
