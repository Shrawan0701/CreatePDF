import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function RedactionCanvas({ source, page, tool, color, regions, selectedId, onSelect, onAdd, onTransient, onFinish, onNudge, disabled }) {
  const scroller = useRef(null), stage = useRef(null), canvas = useRef(null), gesture = useRef(null)
  const [bounds, setBounds] = useState({ width: 600, height: 650 }), [zoom, setZoom] = useState('fit-page')
  const [view, setView] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [draft, setDraft] = useState(null)
  const ready = view?.source === source && view?.page === page && view?.zoom === zoom && view?.bounds === bounds
  const failed = failure?.source === source && failure?.page === page && failure?.zoom === zoom && failure?.bounds === bounds
  useEffect(() => {
    const element = scroller.current, observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) }
      if (next.width && next.height) setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false, task
    setDraft(null)
    const buffer = document.createElement('canvas')
    ;(async () => {
      const pdfPage = await source.pdf.getPage(page)
      if (cancelled) return
      const native = pdfPage.getViewport({ scale: 1 }), fitWidth = Math.max(80, bounds.width - 40) / native.width
      const fitPage = Math.min(fitWidth, Math.max(80, bounds.height - 40) / native.height)
      const scale = zoom === 'fit-page' ? fitPage : zoom === 'fit-width' ? fitWidth : Number(zoom), viewport = pdfPage.getViewport({ scale })
      const density = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
      buffer.width = Math.max(1, Math.ceil(viewport.width * density)); buffer.height = Math.max(1, Math.ceil(viewport.height * density))
      task = pdfPage.render({ canvasContext: buffer.getContext('2d'), viewport, transform: [density, 0, 0, density, 0, 0], background: '#ffffff' })
      await task.promise
      if (cancelled || !canvas.current) return
      canvas.current.width = buffer.width; canvas.current.height = buffer.height; canvas.current.getContext('2d').drawImage(buffer, 0, 0)
      setView({ source, page, zoom, bounds, width: viewport.width, height: viewport.height }); setFailure(null)
    })().catch(error => { if (!cancelled) setFailure({ source, page, zoom, bounds, message: error.message || 'Could not display this page.' }) }).finally(() => { buffer.width = buffer.height = 0 })
    return () => { cancelled = true; task?.cancel(); gesture.current = null }
  }, [source, page, zoom, bounds, retry])
  useEffect(() => { scroller.current?.scrollTo({ top: 0, left: 0 }); setDraft(null) }, [source, page])

  const point = event => {
    const rect = stage.current.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) }
  }
  const start = (event, region, direction = 'draw') => {
    if (disabled || !ready || event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    if (!region && tool !== 'draw') { onSelect(null); return }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(region?.id || null)
    gesture.current = { start: point(event), original: region, direction, snapshot: regions, moved: false }
  }
  const move = event => {
    const active = gesture.current
    if (!active || !ready || disabled) return
    const next = point(event), dx = next.x - active.start.x, dy = next.y - active.start.y
    if (!active.moved && Math.hypot(dx * view.width, dy * view.height) < 3) return
    active.moved = true
    if (active.direction === 'draw') {
      active.draft = { x: Math.min(active.start.x, next.x), y: Math.min(active.start.y, next.y), width: Math.abs(dx), height: Math.abs(dy), color }
      setDraft(active.draft); return
    }
    const original = active.original
    const minW = Math.min(.02, 3 / view.width, original.x + original.width, 1 - original.x), minH = Math.min(.02, 3 / view.height, original.y + original.height, 1 - original.y)
    let left = original.x, top = original.y, right = original.x + original.width, bottom = original.y + original.height
    if (active.direction === 'move') {
      left = clamp(original.x + dx, 0, Math.max(0, 1 - original.width)); top = clamp(original.y + dy, 0, Math.max(0, 1 - original.height)); right = left + original.width; bottom = top + original.height
    } else {
      if (active.direction.includes('w')) left = clamp(left + dx, 0, right - minW)
      if (active.direction.includes('e')) right = clamp(right + dx, left + minW, 1)
      if (active.direction.includes('n')) top = clamp(top + dy, 0, bottom - minH)
      if (active.direction.includes('s')) bottom = clamp(bottom + dy, top + minH, 1)
    }
    onTransient(previous => previous.map(region => region.id === original.id ? { ...region, x: left, y: top, width: right - left, height: bottom - top } : region))
  }
  const end = (cancelled = false) => {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    if (active.direction === 'draw') {
      if (!cancelled && active.moved && active.draft && active.draft.width * view.width >= 3 && active.draft.height * view.height >= 3) onAdd({ ...active.draft, page })
    } else if (active.moved) cancelled ? onTransient(() => active.snapshot) : onFinish(active.snapshot)
    setDraft(null)
  }
  return <div className="redact-canvas-editor"><div className="redact-canvas-options"><span>{tool === 'draw' ? 'Drag to mark an area' : 'Select an area to adjust it'}</span><select className="form-select" aria-label="Redaction preview zoom" disabled={disabled} value={zoom} onChange={event => { end(); setZoom(event.target.value) }}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></div>
    <div ref={scroller} className="redact-scroll"><div ref={stage} className={`redact-sheet${tool === 'draw' ? ' drawing' : ''}`} style={{ width: view?.width || 400, height: view?.height || 560 }} onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end()}>
      <canvas ref={canvas} role="img" aria-label={`PDF page ${page}, mark areas to redact`} />
      {ready && regions.filter(region => region.page === page).map(region => <div key={region.id} role="group" tabIndex={disabled ? -1 : 0} aria-label={`Redaction area on page ${page}`} className={`redact-box${selectedId === region.id ? ' selected' : ''}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`, background: region.color }} onFocus={() => onSelect(region.id)} onPointerDown={event => start(event, region, 'move')} onKeyDown={event => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        if (!disabled && directions[event.key]) { event.preventDefault(); event.stopPropagation(); const [x, y] = directions[event.key], amount = event.shiftKey ? .02 : .002; onNudge(region.id, x * amount, y * amount) }
      }}>{selectedId === region.id && !disabled && handles.map(direction => <button key={direction} className={`redact-handle handle-${direction}`} aria-label={`Resize redaction ${direction}`} onPointerDown={event => start(event, region, direction)} />)}</div>)}
      {ready && draft && <div className="redact-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%`, background: draft.color }} />}
    </div></div>
    {!ready && <div className="redact-render-status" role="status">{failed ? <><span>{failure.message}</span><button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></> : <><LoaderCircle size={18} className="redact-spin" /> Loading page…</>}</div>}
  </div>
}
