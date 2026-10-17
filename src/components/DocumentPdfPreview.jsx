import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

export function DocumentPdfPreview({ blob, updating, error, empty, emptyLabel = 'Add HTML to preview' }) {
  const viewportRef = useRef(null)
  const canvasRef = useRef(null)
  const [documentState, setDocumentState] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState('fit-page')
  const [bounds, setBounds] = useState({ width: 400, height: 560 })
  const [rendered, setRendered] = useState(null)
  const [failure, setFailure] = useState(null)
  const pdf = documentState && documentState.blob === blob ? documentState.pdf : null
  const currentPage = Math.min(pageNumber, pdf?.numPages || 1)
  const renderError = failure && failure.blob === blob ? failure.message : ''

  useEffect(() => {
    const viewport = viewportRef.current
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!blob) return
    let cancelled = false
    let task
    const load = async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const pdfjs = await getPdfjsLib()
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes })
      const pdf = await task.promise
      if (!cancelled) {
        setDocumentState({ blob, pdf })
        setPageNumber(1)
      }
    }
    load().catch(error => { if (!cancelled) setFailure({ blob, message: error.message }) })
    return () => { cancelled = true; task?.destroy().catch(() => {}) }
  }, [blob])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    let task
    const render = async () => {
      const page = await pdf.getPage(currentPage)
      if (cancelled) return
      const original = page.getViewport({ scale: 1 })
      const fitWidth = Math.max(80, bounds.width - 32) / original.width
      const fitPage = Math.min(fitWidth, Math.max(80, bounds.height - 32) / original.height)
      const scale = zoom === 'fit-width' ? fitWidth : zoom === 'fit-page' ? fitPage : Number(zoom)
      const density = Math.min(window.devicePixelRatio || 1, 2)
      const canvas = canvasRef.current
      const viewport = page.getViewport({ scale: scale * density })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.width = `${original.width * scale}px`
      canvas.style.height = `${original.height * scale}px`
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      await task.promise
      if (!cancelled) setRendered({ pdf, page: currentPage, zoom, bounds })
    }
    render().catch(error => { if (!cancelled) setFailure({ blob, message: error.message }) })
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, currentPage, zoom, bounds, blob])

  const ready = rendered?.pdf === pdf && rendered?.page === currentPage && rendered?.zoom === zoom && rendered?.bounds === bounds
  const message = error || renderError
  return <div className="tool-panel document-preview pdf-document-preview" aria-busy={updating}>
    <div className="pdf-preview-heading"><h2 className="tool-panel-title">PDF preview</h2><span className="form-hint" role="status">{empty ? emptyLabel : updating ? 'Updating preview…' : message ? 'Preview unavailable' : 'Matches your download'}</span></div>
    <div className="pdf-preview-toolbar">
      <div className="pdf-preview-navigation">
        <button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous preview page" disabled={!pdf || currentPage <= 1} onClick={() => setPageNumber(currentPage - 1)}><ChevronLeft size={16} /></button>
        <span aria-live="polite">{pdf ? `Page ${currentPage} of ${pdf.numPages}` : 'No pages'}</span>
        <button className="btn btn-secondary btn-icon btn-sm" aria-label="Next preview page" disabled={!pdf || currentPage >= pdf.numPages} onClick={() => setPageNumber(currentPage + 1)}><ChevronRight size={16} /></button>
      </div>
      <select className="form-select" aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}>
        <option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option>
      </select>
    </div>
    {message && <p className="pdf-preview-error" role="alert">{message}</p>}
    <div ref={viewportRef} className="pdf-preview-viewport" tabIndex={0} role="region" aria-label="PDF page preview">
      <canvas ref={canvasRef} hidden={!pdf || empty} role="img" aria-label={`PDF preview page ${currentPage} of ${pdf?.numPages || 0}`} data-rendered-page={ready ? currentPage : ''} />
      {(!pdf || empty) && <p className="empty-copy">{empty ? 'Your PDF pages will appear here.' : message ? 'Edit the content or settings to refresh the preview.' : 'Preparing your PDF preview…'}</p>}
    </div>
  </div>
}
