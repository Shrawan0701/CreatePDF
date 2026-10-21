import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

export function WatermarkPdfPreview({ blob, page, pageCount, onPage, updating, error, label = 'Watermark', updatingLabel = 'Updating watermark…' }) {
  const viewport = useRef(null), canvas = useRef(null)
  const [documentState, setDocumentState] = useState(null), [rendered, setRendered] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0)
  const [zoom, setZoom] = useState('fit-page'), [bounds, setBounds] = useState({ width: 600, height: 700 })
  const pdf = documentState && documentState.blob === blob ? documentState.pdf : null
  const ready = rendered?.pdf === pdf && rendered?.page === page && rendered?.zoom === zoom && rendered?.bounds === bounds
  const message = error || (failure && failure.blob === blob ? failure.message : '')
  useEffect(() => {
    const element = viewport.current, observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) }
      if (next.width && next.height) setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!blob) return
    let cancelled = false, task
    ;(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer()), pdfjs = await getPdfjsLib()
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
      const loaded = await task.promise
      if (!cancelled) { setDocumentState({ blob, pdf: loaded }); setFailure(null) }
    })().catch(failure => { if (!cancelled) setFailure({ blob, message: failure.message || 'Could not open this PDF preview.' }) })
    return () => { cancelled = true; task?.destroy().catch(() => {}) }
  }, [blob, retry])
  useEffect(() => {
    if (!pdf) return
    let cancelled = false, task
    const buffer = document.createElement('canvas')
    ;(async () => {
      const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages))
      if (cancelled) return
      const native = pdfPage.getViewport({ scale: 1 }), fitWidth = Math.max(80, bounds.width - 40) / native.width, fitPage = Math.min(fitWidth, Math.max(80, bounds.height - 40) / native.height)
      const scale = zoom === 'fit-page' ? fitPage : zoom === 'fit-width' ? fitWidth : Number(zoom), logical = pdfPage.getViewport({ scale })
      const density = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(logical.width, logical.height), Math.sqrt(16_000_000 / (logical.width * logical.height)))
      buffer.width = Math.max(1, Math.ceil(logical.width * density)); buffer.height = Math.max(1, Math.ceil(logical.height * density))
      task = pdfPage.render({ canvasContext: buffer.getContext('2d'), viewport: logical, transform: [density, 0, 0, density, 0, 0], background: '#ffffff' })
      await task.promise
      if (cancelled || !canvas.current) return
      canvas.current.width = buffer.width; canvas.current.height = buffer.height; canvas.current.getContext('2d').drawImage(buffer, 0, 0)
      setRendered({ pdf, page, zoom, bounds, width: logical.width, height: logical.height }); setFailure(null)
    })().catch(failure => { if (!cancelled) setFailure({ blob, message: failure.message || 'Could not render this page.' }) }).finally(() => { buffer.width = buffer.height = 0 })
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, page, zoom, bounds, blob])
  return <div className="watermark-pdf-preview" aria-busy={updating}>
    <div className="watermark-preview-toolbar"><div><button className="btn btn-secondary btn-icon btn-sm" aria-label={`Previous ${label.toLowerCase()} page`} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><select className="form-select" aria-label={`${label} preview page`} value={page} onChange={event => onPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index} value={index + 1}>Page {index + 1}</option>)}</select><span>of {pageCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label={`Next ${label.toLowerCase()} page`} disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div><select className="form-select" aria-label={`${label} preview zoom`} value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></div>
    <div className="watermark-preview-status" role="status">{message ? 'Preview unavailable' : updating ? updatingLabel : ready ? 'Ready' : 'Loading page…'}</div>
    {message && <p className="watermark-error" role="alert">{message}<button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Retry page</button></p>}
    <div ref={viewport} className="watermark-preview-viewport"><canvas ref={canvas} hidden={!rendered} style={rendered ? { width: rendered.width, height: rendered.height } : undefined} role="img" aria-label={`PDF preview page ${rendered?.page || page}`} />{!rendered && <span>{message ? 'Preview unavailable.' : 'Preparing your preview…'}</span>}</div>
  </div>
}
