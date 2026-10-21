import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function SignPdfCanvas({ source, page, zoom, items, selectedId, onSelect, onTransient, onFinish, onGeometry, disabled }) {
  const scroller = useRef(null), stage = useRef(null), canvas = useRef(null), interaction = useRef(null)
  const [width, setWidth] = useState(600), [view, setView] = useState(null), [failure, setFailure] = useState(''), [retry, setRetry] = useState(0)
  const ready = view?.source === source && view?.page === page && view?.zoom === zoom && view?.containerWidth === width
  useEffect(() => {
    const element = scroller.current
    const resize = () => {
      const styles = getComputedStyle(element)
      const next = Math.max(120, Math.floor(element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) - 2))
      setWidth(previous => previous === next ? previous : next)
    }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false, task
    onGeometry(null); setFailure('')
    const draw = async () => {
      const pdfPage = await source.pdf.getPage(page)
      if (cancelled) return
      const native = pdfPage.getViewport({ scale: 1 }), scale = Math.min(1100, width) / native.width * zoom
      const viewport = pdfPage.getViewport({ scale })
      const density = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
      const buffer = document.createElement('canvas')
      try {
        buffer.width = Math.max(1, Math.ceil(viewport.width * density)); buffer.height = Math.max(1, Math.ceil(viewport.height * density))
        task = pdfPage.render({ canvasContext: buffer.getContext('2d'), viewport, transform: [density, 0, 0, density, 0, 0], background: '#ffffff' })
        await task.promise
        if (cancelled || !canvas.current) return
        canvas.current.width = buffer.width; canvas.current.height = buffer.height
        canvas.current.getContext('2d').drawImage(buffer, 0, 0)
        const geometry = { source, page, zoom, containerWidth: width, width: viewport.width, height: viewport.height, nativeWidth: native.width, nativeHeight: native.height,
          center: () => {
            const area = scroller.current.getBoundingClientRect(), sheet = stage.current.getBoundingClientRect()
            return { x: clamp((area.left + scroller.current.clientWidth / 2 - sheet.left) / sheet.width, 0, 1), y: clamp((area.top + scroller.current.clientHeight / 2 - sheet.top) / sheet.height, 0, 1) }
          },
        }
        setView(geometry); onGeometry(geometry)
      } finally { buffer.width = buffer.height = 0 }
    }
    draw().catch(error => { if (!cancelled && error.name !== 'RenderingCancelledException') setFailure(error.message || 'Could not render this page.') })
    return () => { cancelled = true; task?.cancel(); interaction.current = null }
  }, [source, page, zoom, width, retry, onGeometry])
  useEffect(() => { scroller.current?.scrollTo({ top: 0, left: 0 }) }, [source, page])
  const point = event => {
    const bounds = stage.current.getBoundingClientRect()
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) }
  }
  const start = (event, item, mode) => {
    event.stopPropagation()
    if (disabled || !ready || event.button !== 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(item.id)
    interaction.current = { id: item.id, mode, original: item, start: point(event), snapshot: items, moved: false }
  }
  const move = event => {
    const active = interaction.current
    if (!active || !ready || disabled) return
    const position = point(event), dx = position.x - active.start.x, dy = position.y - active.start.y, original = active.original
    if (!active.moved && Math.hypot(dx * view.width, dy * view.height) < 2) return
    active.moved = true
    onTransient(previous => previous.map(item => {
      if (item.id !== active.id) return item
      if (active.mode === 'move') return { ...item, x: clamp(original.x + dx, 0, Math.max(0, 1 - item.width)), y: clamp(original.y + dy, 0, Math.max(0, 1 - item.height)) }
      const ratio = original.width / original.height
      const preferred = Math.abs(dx * view.width) >= Math.abs(dy * view.height) ? original.width + dx : (original.height + dy) * ratio
      const width = clamp(preferred, .015, Math.min(1 - original.x, (1 - original.y) * ratio))
      return { ...item, width, height: width / ratio }
    }))
  }
  const end = (cancelled = false) => {
    const active = interaction.current
    if (!active) return
    interaction.current = null
    if (cancelled) onTransient(() => active.snapshot)
    else if (active.moved) onFinish(active.snapshot)
  }
  return <div className="sign-canvas-area"><div ref={scroller} className="sign-page-scroll"><div ref={stage} className="sign-sheet" style={{ width: view?.width || 400, height: view?.height || 560 }} onPointerDown={event => { if (event.target === stage.current && !disabled) onSelect(null) }} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end()}>
    <canvas ref={canvas} role="img" aria-label={`PDF page ${page}`} />
    {ready && items.filter(item => item.page === page).map(item => <div key={item.id} tabIndex={disabled ? -1 : 0} role="group" aria-label={`${item.label || 'Signature'} on page ${page}`} className={`sign-mark${selectedId === item.id ? ' selected' : ''}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} onFocus={() => onSelect(item.id)} onPointerDown={event => start(event, item, 'move')}>
      <img src={item.dataUrl} alt={item.label || 'Signature'} draggable={false} />
      {selectedId === item.id && !disabled && <button className="sign-resize" aria-label="Resize signature" onPointerDown={event => start(event, item, 'resize')} />}
    </div>)}
  </div></div>{!ready && <div className="sign-render-status" role="status">{failure ? <><span>{failure}</span><button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></> : <><LoaderCircle size={19} className="sign-spin" /> Loading page…</>}</div>}</div>
}
