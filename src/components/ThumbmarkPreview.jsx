import { useEffect, useRef, useState } from 'react'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function ThumbmarkPreview({ original, result, crop, onStart, onCrop, onEnd, mode, background, disabled, imageLabel, zoomLabel = 'Thumbmark preview zoom' }) {
  const viewport = useRef(null), stage = useRef(null), canvas = useRef(null), drag = useRef(null)
  const [bounds, setBounds] = useState({ width: 500, height: 600 }), [zoom, setZoom] = useState('fit')
  const image = mode === 'result' ? result?.canvas : original
  const editable = mode === 'crop' && !disabled && !!original
  useEffect(() => {
    const element = viewport.current, observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) }
      if (next.width > 0 && next.height > 0) setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  const scale = image ? zoom === 'fit' ? Math.min(Math.max(60, bounds.width - 44) / image.width, Math.max(60, bounds.height - 44) / image.height) : Number(zoom) : 1
  const width = image ? image.width * scale : 0, height = image ? image.height * scale : 0
  useEffect(() => {
    if (!canvas.current || !image) return
    canvas.current.width = image.width; canvas.current.height = image.height
    canvas.current.getContext('2d').drawImage(image, 0, 0)
  }, [image])
  const point = event => {
    const rect = stage.current.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) }
  }
  const start = (event, direction) => {
    if (!editable || event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { direction, start: point(event), crop }; onStart()
  }
  const adjusted = (initial, direction, dx, dy) => {
    let left = initial.x, top = initial.y, right = initial.x + initial.width, bottom = initial.y + initial.height
    if (direction === 'move') {
      const x = clamp(dx, -left, 1 - right), y = clamp(dy, -top, 1 - bottom)
      left += x; right += x; top += y; bottom += y
    } else {
      if (direction.includes('w')) left = clamp(left + dx, 0, right - .01)
      if (direction.includes('e')) right = clamp(right + dx, left + .01, 1)
      if (direction.includes('n')) top = clamp(top + dy, 0, bottom - .01)
      if (direction.includes('s')) bottom = clamp(bottom + dy, top + .01, 1)
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
  }
  const move = event => {
    const active = drag.current
    if (!active || !editable) return
    const next = point(event), dx = next.x - active.start.x, dy = next.y - active.start.y
    if (active.direction === 'new') {
      const x = Math.min(active.start.x, next.x), y = Math.min(active.start.y, next.y)
      if (Math.abs(dx) + Math.abs(dy) < .01) return
      onCrop({ x: Math.min(x, .99), y: Math.min(y, .99), width: Math.min(1 - x, Math.max(.01, Math.abs(dx))), height: Math.min(1 - y, Math.max(.01, Math.abs(dy))) })
    } else onCrop(adjusted(active.crop, active.direction, dx, dy))
  }
  const end = (cancelled = false) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    if (cancelled) onCrop(active.crop)
    onEnd()
  }
  return <div className="thumb-preview-content"><div className="thumb-zoom-bar"><select className="form-select" aria-label={zoomLabel} value={zoom} onChange={event => { end(); setZoom(event.target.value) }}><option value="fit">Fit image</option><option value="1">100%</option><option value="2">200%</option></select>{image && <span>{image.width} × {image.height} px{mode === 'result' ? ' · Preview' : ''}</span>}</div>
    <div ref={viewport} className={`thumb-image-viewport bg-${background}`}>
      {image ? <div ref={stage} className={`thumb-image-stage${editable ? ' cropping' : ''}`} style={{ width, height }} onPointerDown={event => start(event, 'new')} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end()}>
        <canvas ref={canvas} role="img" aria-label={imageLabel || (mode === 'result' ? 'Processed thumbmark preview' : 'Original thumbprint image')} />
        {editable && <>
          <div className="thumb-crop-shade" style={{ left: 0, top: 0, width: '100%', height: `${crop.y * 100}%` }} /><div className="thumb-crop-shade" style={{ left: 0, top: `${(crop.y + crop.height) * 100}%`, width: '100%', height: `${(1 - crop.y - crop.height) * 100}%` }} /><div className="thumb-crop-shade" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} /><div className="thumb-crop-shade" style={{ left: `${(crop.x + crop.width) * 100}%`, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
          <div className="thumb-crop-box" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}><button className="thumb-crop-move" aria-label="Move crop area" onPointerDown={event => start(event, 'move')} onKeyDown={event => {
            const keys = { ArrowLeft: [-.005, 0], ArrowRight: [.005, 0], ArrowUp: [0, -.005], ArrowDown: [0, .005] }
            if (!keys[event.key]) return
            event.preventDefault(); const [x, y] = keys[event.key], amount = event.shiftKey ? 5 : 1
            onCrop(adjusted(crop, 'move', x * amount, y * amount), true)
          }} />{directions.map(direction => <button key={direction} className={`thumb-crop-handle handle-${direction}`} aria-label={`Resize crop ${direction}`} onPointerDown={event => start(event, direction)} />)}</div>
        </>}
      </div> : <span className="thumb-empty-preview">Preparing preview…</span>}
    </div>
  </div>
}
