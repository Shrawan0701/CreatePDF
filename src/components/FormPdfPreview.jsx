import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

export function FormPdfPreview({ blob, fields, active, onSelect, page, onPage, updating, error }) {
  const viewport = useRef(null), canvas = useRef(null)
  const [documentState, setDocumentState] = useState(null), [failure, setFailure] = useState(null), [rendered, setRendered] = useState(null)
  const [zoom, setZoom] = useState('fit-page'), [bounds, setBounds] = useState({ width: 550, height: 700 }), [highlight, setHighlight] = useState(true)
  const pdf = documentState && documentState.blob === blob ? documentState.pdf : null
  const number = Math.min(Math.max(1, page), pdf?.numPages || page || 1)
  const message = error || (failure?.blob === blob ? failure.message : '')
  const ready = rendered?.pdf === pdf && rendered?.number === number && rendered?.zoom === zoom && rendered?.bounds === bounds
  useEffect(() => {
    const element = viewport.current, observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) }
      setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!blob) return
    let cancelled = false, task
    ;(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer()), pdfjs = await getPdfjsLib()
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes })
      const loaded = await task.promise
      if (!cancelled) { setDocumentState({ blob, pdf: loaded }); setFailure(null) }
    })().catch(failure => { if (!cancelled) setFailure({ blob, message: failure.message || 'Could not open the preview.' }) })
    return () => { cancelled = true; task?.destroy().catch(() => {}) }
  }, [blob])
  useEffect(() => {
    if (!pdf) return
    let cancelled = false, task
    const buffer = document.createElement('canvas')
    ;(async () => {
      const source = await pdf.getPage(number)
      if (cancelled) return
      const original = source.getViewport({ scale: 1 }), fitWidth = Math.max(80, bounds.width - 40) / original.width
      const fitPage = Math.min(fitWidth, Math.max(80, bounds.height - 40) / original.height)
      const scale = zoom === 'fit-page' ? fitPage : zoom === 'fit-width' ? fitWidth : Number(zoom), density = Math.min(window.devicePixelRatio || 1, 2)
      const logical = source.getViewport({ scale }), pixels = source.getViewport({ scale: scale * density })
      buffer.width = Math.ceil(pixels.width); buffer.height = Math.ceil(pixels.height)
      task = source.render({ canvasContext: buffer.getContext('2d'), viewport: pixels, background: '#ffffff' })
      await task.promise
      if (cancelled || !canvas.current) return
      canvas.current.width = buffer.width; canvas.current.height = buffer.height
      canvas.current.getContext('2d').drawImage(buffer, 0, 0)
      setFailure(null)
      setRendered({ pdf, number, zoom, bounds, viewport: logical, width: logical.width, height: logical.height })
    })().catch(failure => { if (!cancelled) setFailure({ blob, message: failure.message || 'Could not render this page.' }) }).finally(() => { buffer.width = buffer.height = 0 })
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, number, zoom, bounds, blob])
  const targets = ready ? fields.flatMap(field => field.widgets.filter(widget => widget.page === number).map((widget, index) => {
    const { x, y, width, height } = widget.rect
    // PDF.js 6 exposes point conversion; map all four corners so highlights
    // also follow rotated pages and cropped page viewports.
    const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([left, top]) => rendered.viewport.convertToViewportPoint(left, top))
    const left = Math.min(...corners.map(point => point[0])), top = Math.min(...corners.map(point => point[1]))
    const right = Math.max(...corners.map(point => point[0])), bottom = Math.max(...corners.map(point => point[1]))
    return <button key={`${field.id}-${index}`} className={`form-pdf-target${active === field.name ? ' active' : ''}${highlight ? ' highlighted' : ''}`} style={{ left, top, width: right - left, height: bottom - top }} aria-label={`Edit ${field.label}`} title={field.label} onClick={() => onSelect(field)} />
  })) : null
  return <section className="form-pdf-preview" aria-label="Fillable PDF preview" aria-busy={updating}>
    <div className="form-pdf-toolbar"><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous PDF page" disabled={!pdf || number <= 1} onClick={() => onPage(number - 1)}><ChevronLeft size={16} /></button><span>Page {number}{pdf ? ` of ${pdf.numPages}` : ''}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next PDF page" disabled={!pdf || number >= pdf.numPages} onClick={() => onPage(number + 1)}><ChevronRight size={16} /></button></div><select className="form-select" aria-label="PDF preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></div>
    <div className="form-pdf-status"><label><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} /> Highlight fields</label><span role="status">{message ? 'Preview unavailable' : updating ? 'Updating…' : ready ? 'Ready' : 'Loading…'}</span></div>
    {message && <p className="fill-form-error" role="alert">{message}</p>}
    <div ref={viewport} className="form-pdf-viewport"><div className="form-pdf-page" hidden={!rendered} style={{ width: rendered?.width, height: rendered?.height }}><canvas ref={canvas} role="img" aria-label={`Form PDF page ${rendered?.number || number}`} />{targets}</div>{!rendered && <span className="form-pdf-empty">{message ? 'Check the form entries to update the preview.' : 'Preparing PDF preview…'}</span>}</div>
  </section>
}
