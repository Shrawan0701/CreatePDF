import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Grid3x3, LoaderCircle } from 'lucide-react'
import { getPdfjsLib } from '../services/pdfEngine'

export function NupSheetPreview({ source, plan, sheetIndex, onSheet }) {
  const viewportRef = useRef(null), canvasRef = useRef(null)
  const [loaded, setLoaded] = useState(null), [failure, setFailure] = useState(null), [rendered, setRendered] = useState(null)
  const [bounds, setBounds] = useState({ width: 500, height: 600 }), [zoom, setZoom] = useState('fit')
  const pdf = loaded?.source === source ? loaded.pdf : null
  const sheet = Math.max(0, Math.min(sheetIndex, (plan?.sheetCount || 1) - 1))
  const ready = rendered?.pdf === pdf && rendered?.plan === plan && rendered?.sheet === sheet && rendered?.bounds === bounds && rendered?.zoom === zoom
  const error = failure?.source === source && failure?.plan === plan ? failure.message : ''
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width), height = Math.floor(entry.contentRect.height)
      if (width <= 0 || height <= 0) return
      setBounds(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setLoaded(null); setFailure(null); setRendered(null)
    if (!source) return
    let disposed = false, task
    const open = async () => {
      const pdfjs = await getPdfjsLib()
      if (disposed) return
      task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false })
      const document = await task.promise
      if (!disposed) setLoaded({ source, pdf: document })
    }
    open().catch(failure => { if (!disposed) setFailure({ source, plan: null, message: failure.message || 'Could not load the preview.' }) })
    return () => { disposed = true; task?.destroy().catch(() => {}) }
  }, [source])
  useEffect(() => {
    if (!pdf || !plan) return
    let disposed = false, task
    const draw = async () => {
      setFailure(null)
      const scale = zoom === 'fit' ? Math.max(.03, Math.min((bounds.width - 2) / plan.width, (bounds.height - 2) / plan.height)) : Number(zoom)
      const density = Math.min(window.devicePixelRatio || 1, 2), pixelScale = scale * density
      // Compose offscreen, then replace the visible sheet once. A cancelled
      // resize must not clear or progressively repaint the user's preview.
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(plan.width * pixelScale); canvas.height = Math.ceil(plan.height * pixelScale)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      for (const placement of plan.sheets[sheet]) {
        const page = await pdf.getPage(placement.number)
        if (disposed) return
        const viewport = page.getViewport({ scale: placement.scale * pixelScale / (page.userUnit || 1), rotation: placement.rotation })
        const tile = document.createElement('canvas')
        tile.width = Math.max(1, Math.ceil(viewport.width)); tile.height = Math.max(1, Math.ceil(viewport.height))
        task = page.render({ canvasContext: tile.getContext('2d'), viewport })
        await task.promise
        if (disposed) return
        const x = placement.x * pixelScale, y = (plan.height - placement.y - placement.height) * pixelScale
        context.drawImage(tile, x, y, placement.width * pixelScale, placement.height * pixelScale)
        tile.width = 0; tile.height = 0
        if (plan.borders) { context.strokeStyle = '#a6abad'; context.lineWidth = Math.max(.5, .4 * pixelScale); context.strokeRect(x, y, placement.width * pixelScale, placement.height * pixelScale) }
      }
      if (!disposed) {
        const visible = canvasRef.current
        visible.width = canvas.width; visible.height = canvas.height
        visible.style.width = `${plan.width * scale}px`; visible.style.height = `${plan.height * scale}px`
        visible.getContext('2d').drawImage(canvas, 0, 0)
        setRendered({ pdf, plan, sheet, bounds, zoom })
      }
    }
    draw().catch(failure => { if (!disposed) setFailure({ source, plan, message: failure.message || 'Could not render this sheet.' }) })
    return () => { disposed = true; task?.cancel() }
  }, [source, pdf, plan, sheet, bounds, zoom])
  const loadError = failure?.source === source && failure?.plan === null ? failure.message : ''

  return <section className="tool-panel nup-sheet-preview" aria-label="Sheet preview">
    <div className="nup-preview-toolbar"><div><strong>Sheet preview</strong>{plan && <span>{plan.paper} · {plan.orientation} · {plan.columns} × {plan.rows}</span>}</div><select className="form-select" aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit sheet</option><option value={4 / 3}>100%</option><option value={2}>150%</option></select></div>
    <div className="nup-preview-frame"><div ref={viewportRef} className="nup-preview-viewport" tabIndex={0} role="region" aria-label="Sheet canvas" aria-busy={!!source && !!plan && !ready && !error && !loadError}>
      <canvas ref={canvasRef} hidden={!source || !plan || !rendered || rendered.pdf !== pdf} role="img" aria-label={`Sheet ${sheet + 1}${plan ? `, source pages ${plan.sheets[sheet].map(page => page.number).join(', ')}` : ''}`} />
      {!source || !plan ? <div className="nup-preview-empty"><Grid3x3 size={38} /><span>{source ? 'Choose valid settings to preview' : 'Choose a PDF to see your sheet'}</span></div> : (error || loadError) && <div className="nup-preview-empty"><span>Preview unavailable</span><span className="nup-preview-error">{error || loadError}</span></div>}
    </div>{source && plan && !ready && !error && !loadError && <div className="nup-preview-loading" role="status"><LoaderCircle size={19} className="nup-spin" /> Updating sheet…</div>}</div>
    <div className="nup-sheet-navigation"><button className="btn btn-secondary btn-icon btn-sm" disabled={!plan || sheet === 0} onClick={() => onSheet(sheet - 1)} aria-label="Previous sheet"><ChevronLeft size={16} /></button><span>{plan ? `Sheet ${sheet + 1} of ${plan.sheetCount}` : 'No sheets'}</span><button className="btn btn-secondary btn-icon btn-sm" disabled={!plan || sheet + 1 >= plan.sheetCount} onClick={() => onSheet(sheet + 1)} aria-label="Next sheet"><ChevronRight size={16} /></button></div>
  </section>
}
