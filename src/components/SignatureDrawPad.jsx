import { useEffect, useRef } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { drawSignatureStrokes } from '../services/pdfSigning'

export function SignatureDrawPad({ strokes, onChange, color, width, disabled }) {
  const canvas = useRef(null), active = useRef(null), frame = useRef(null)
  const latest = useRef({ strokes, color, width }); latest.current = { strokes, color, width }
  const redraw = () => {
    frame.current = null
    const value = latest.current
    if (canvas.current) drawSignatureStrokes(canvas.current, active.current ? [...value.strokes, active.current.points] : value.strokes, value)
  }
  useEffect(() => { redraw() }, [strokes, color, width])
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])
  const point = event => {
    const rect = canvas.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const finish = (event, cancelled = false) => {
    if (!active.current || event.pointerId !== active.current.pointerId) return
    const points = active.current.points; active.current = null
    if (!cancelled) onChange([...latest.current.strokes, points])
    else redraw()
  }
  return <div className="sign-draw">
    <canvas ref={canvas} className="sign-ink-pad" width={1000} height={500} tabIndex={disabled ? -1 : 0} aria-label="Draw your signature" aria-disabled={disabled}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || active.current) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        active.current = { pointerId: event.pointerId, points: [point(event)] }; redraw()
      }}
      onPointerMove={event => {
        if (!active.current || event.pointerId !== active.current.pointerId) return
        const events = event.nativeEvent.getCoalescedEvents?.() || []
        for (const sample of events.length ? events : [event]) active.current.points.push(point(sample))
        if (!frame.current) frame.current = requestAnimationFrame(redraw)
      }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event)}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (!disabled) onChange(strokes.slice(0, -1)) } }} />
    <div className="sign-draw-actions"><button className="btn btn-secondary btn-sm" disabled={disabled || !strokes.length} onClick={() => onChange(strokes.slice(0, -1))}><Undo2 size={13} /> Undo stroke</button><button className="btn btn-secondary btn-sm" disabled={disabled || !strokes.length} onClick={() => onChange([])}><Trash2 size={13} /> Clear</button></div>
  </div>
}
