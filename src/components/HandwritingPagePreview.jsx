import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { drawHandwritingPreview } from '../services/pdfHandwriting'

export function HandwritingPagePreview({ plan, page, onPage, updating }) {
  const viewport = useRef(null), canvas = useRef(null)
  const [bounds, setBounds] = useState({ width: 500, height: 650 }), [zoom, setZoom] = useState('fit-page'), [error, setError] = useState('')
  const index = Math.min(page, Math.max(0, (plan?.pages.length || 1) - 1))
  useEffect(() => {
    const element = viewport.current
    const observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) }
      setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!plan || !canvas.current) return
    setError('')
    const buffer = document.createElement('canvas')
    try {
      const fitWidth = Math.max(80, bounds.width - 36) / plan.width
      const fitPage = Math.min(fitWidth, Math.max(80, bounds.height - 36) / plan.height)
      const scale = zoom === 'fit-page' ? fitPage : zoom === 'fit-width' ? fitWidth : Number(zoom)
      drawHandwritingPreview(buffer, plan, index, scale * Math.min(window.devicePixelRatio || 1, 2))
      canvas.current.width = buffer.width; canvas.current.height = buffer.height
      canvas.current.style.width = `${plan.width * scale}px`; canvas.current.style.height = `${plan.height * scale}px`
      canvas.current.getContext('2d').drawImage(buffer, 0, 0)
    } catch (failure) { setError(failure.message || 'Could not draw this page.') }
    finally { buffer.width = buffer.height = 0 }
  }, [plan, index, bounds, zoom])
  return <div className="hand-page-preview" aria-busy={updating}>
    <div className="hand-preview-toolbar"><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous handwriting page" disabled={!plan || index === 0} onClick={() => onPage(index - 1)}><ChevronLeft size={16} /></button><span>{plan ? `${index + 1} / ${plan.pages.length}` : 'No pages'}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next handwriting page" disabled={!plan || index >= plan.pages.length - 1} onClick={() => onPage(index + 1)}><ChevronRight size={16} /></button></div><span className="hand-preview-source">{updating ? 'Updating…' : plan?.pages[index].sourcePage ? `Source page ${plan.pages[index].sourcePage}` : ''}</span><select className="form-select" aria-label="Handwriting preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="1">100%</option><option value="1.5">150%</option></select></div>
    <div ref={viewport} className="hand-preview-viewport"><canvas ref={canvas} hidden={!plan || !!error} role="img" aria-label={`Handwriting page ${index + 1}`} />{(!plan || error) && <div className="hand-preview-empty">{error || 'Your handwriting pages appear here.'}</div>}</div>
  </div>
}
