import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Crop, Download, Fingerprint, FlipHorizontal2, FlipVertical2, LoaderCircle, Maximize2, Redo2, RotateCcw, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { ThumbmarkPreview } from './ThumbmarkPreview'
import { DropZone, FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { orientThumbmark, readThumbmarkImage, renderThumbmark, thumbmarkDefaults, thumbmarkPdf, thumbmarkPng } from '../services/thumbmark'
import './ThumbmarkWorkspace.css'

const emptyHistory = () => ({ past: [], options: thumbmarkDefaults(), future: [] })
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function ThumbmarkWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(emptyHistory)
  const [preview, setPreview] = useState(null), [processing, setProcessing] = useState(false), [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState('')
  const [previewFailure, setPreviewFailure] = useState(null), [previewRetry, setPreviewRetry] = useState(0)
  const [mode, setMode] = useState('result'), [viewerBackground, setViewerBackground] = useState('white'), [format, setFormat] = useState('png'), [pdfWidth, setPdfWidth] = useState('25')
  const fileInput = useRef(null), cameraInput = useRef(null), reading = useRef(null), operation = useRef(null), fullCache = useRef(null), snapshot = useRef(null)
  const options = history.options, locked = loading || exporting
  const params = useMemo(() => ({ source, options }), [source, options])
  const original = useMemo(() => source ? orientThumbmark(source, { rotation: options.rotation, flipX: options.flipX, flipY: options.flipY }) : null, [source, options.rotation, options.flipX, options.flipY])
  const current = preview?.params === params
  const previewFailed = previewFailure?.params === params
  const validWidth = Number.isFinite(Number(pdfWidth)) && Number(pdfWidth) >= 10 && Number(pdfWidth) <= 60

  const clearCache = () => {
    if (fullCache.current) fullCache.current.canvas.width = fullCache.current.canvas.height = 0
    fullCache.current = null
  }
  useEffect(() => () => { source && (source.canvas.width = source.canvas.height = 0) }, [source])
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort(); clearCache() }, [])
  useEffect(() => {
    if (!source) { setPreview(null); setPreviewFailure(null); setProcessing(false); return }
    const controller = new AbortController()
    setProcessing(true); setPreviewFailure(null)
    const timer = setTimeout(() => {
      renderThumbmark(source, options, { signal: controller.signal, maxEdge: 1400 }).then(result => {
        if (!controller.signal.aborted) setPreview({ ...result, params })
        else result.canvas.width = result.canvas.height = 0
      }).catch(failure => { if (!controller.signal.aborted) { const message = failure.message || 'Could not prepare this preview.'; setPreviewFailure({ params, message }); setError(message) } }).finally(() => { if (!controller.signal.aborted) setProcessing(false) })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [params, previewRetry])

  const commit = updates => {
    clearCache(); setError('')
    setHistory(previous => ({ past: [...previous.past.slice(-49), previous.options], options: typeof updates === 'function' ? updates(previous.options) : { ...previous.options, ...updates }, future: [] }))
  }
  const transient = updates => {
    clearCache(); setError('')
    setHistory(previous => ({ ...previous, options: { ...previous.options, ...updates } }))
  }
  const begin = () => { if (!snapshot.current) snapshot.current = options }
  const finish = () => {
    const initial = snapshot.current; snapshot.current = null
    if (initial) setHistory(previous => JSON.stringify(initial) === JSON.stringify(previous.options) ? previous : { ...previous, past: [...previous.past.slice(-49), initial], future: [] })
  }
  const changeRange = updates => { snapshot.current ? transient(updates) : commit(updates) }
  const undo = () => {
    finish(); clearCache(); setError('')
    setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), options: previous.past.at(-1), future: [previous.options, ...previous.future] } : previous)
  }
  const redo = () => {
    finish(); clearCache(); setError('')
    setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.options], options: previous.future[0], future: previous.future.slice(1) } : previous)
  }
  const cropChange = (crop, committed = false) => { committed ? commit({ crop }) : transient({ crop }) }
  const rotate = clockwise => {
    finish()
    commit(previous => {
      const crop = previous.crop
      return { ...previous, rotation: (previous.rotation + (clockwise ? 90 : 270)) % 360, flipX: previous.flipY, flipY: previous.flipX, crop: clockwise ? { x: Math.max(0, 1 - crop.y - crop.height), y: crop.x, width: crop.height, height: crop.width } : { x: crop.y, y: Math.max(0, 1 - crop.x - crop.width), width: crop.height, height: crop.width } }
    })
  }
  const flip = horizontal => {
    finish()
    commit(previous => horizontal ? { ...previous, flipX: !previous.flipX, crop: { ...previous.crop, x: Math.max(0, 1 - previous.crop.x - previous.crop.width) } } : { ...previous, flipY: !previous.flipY, crop: { ...previous.crop, y: Math.max(0, 1 - previous.crop.y - previous.crop.height) } })
  }
  const autoCrop = () => {
    if (!current || !preview.bounds || locked) return
    const box = preview.bounds, crop = options.crop
    commit({ crop: { x: crop.x + box.x * crop.width, y: crop.y + box.y * crop.height, width: box.width * crop.width, height: box.height * crop.height } }); setMode('crop')
  }
  const changeEdge = (edge, value) => {
    const crop = options.crop
    let left = crop.x, top = crop.y, right = crop.x + crop.width, bottom = crop.y + crop.height
    const amount = Number(value) / 100
    if (edge === 'left') left = clamp(amount, 0, right - .01)
    if (edge === 'top') top = clamp(amount, 0, bottom - .01)
    if (edge === 'right') right = clamp(1 - amount, left + .01, 1)
    if (edge === 'bottom') bottom = clamp(1 - amount, top + .01, 1)
    commit({ crop: { x: left, y: top, width: right - left, height: bottom - top } })
  }
  const load = async incoming => {
    if (operation.current) return
    const file = incoming[0]
    if (!file) return
    reading.current?.abort()
    const controller = new AbortController(); reading.current = controller
    setLoading(true); setError('')
    try {
      const loaded = await readThumbmarkImage(file, controller.signal)
      if (controller.signal.aborted || reading.current !== controller) { loaded.canvas.width = loaded.canvas.height = 0; return }
      clearCache(); snapshot.current = null
      setSource(loaded); setHistory(emptyHistory()); setPreview(null); setMode('result'); setViewerBackground('white')
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open this image.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false) } }
  }
  const close = () => {
    if (locked) return
    clearCache(); snapshot.current = null; setSource(null); setHistory(emptyHistory()); setPreview(null); setViewerBackground('white'); setError('')
  }
  const download = async () => {
    if (!source || !current || preview.empty || locked || (format === 'pdf' && !validWidth)) return
    const controller = new AbortController(); operation.current = controller; setExporting(true); setError('')
    try {
      let full = fullCache.current
      if (full?.params !== params) {
        const rendered = await renderThumbmark(source, options, { signal: controller.signal, maxEdge: 4096 })
        if (controller.signal.aborted || operation.current !== controller) { rendered.canvas.width = rendered.canvas.height = 0; return }
        full = { ...rendered, params, blobs: new Map() }; clearCache(); fullCache.current = full
      }
      if (full.empty) throw new Error('No visible ink remains. Reduce background cleanup.')
      const key = `${format}:${options.background}:${format === 'pdf' ? Number(pdfWidth) : ''}`
      let blob = full.blobs.get(key)
      if (!blob) { blob = format === 'pdf' ? await thumbmarkPdf(full.canvas, pdfWidth, options.background) : await thumbmarkPng(full.canvas, options.background); full.blobs.set(key, blob) }
      if (controller.signal.aborted || operation.current !== controller) return
      const stem = source.file.name.replace(/\.[^.]+$/, '') || 'image'
      downloadBlob(blob, `${stem}-thumbmark.${format}`)
      showToast(format === 'png' ? `PNG ready · ${full.width} × ${full.height} px` : 'Thumbmark PDF ready.', 'success')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not export this thumbmark.') }
    finally { if (operation.current === controller) { operation.current = null; setExporting(false) } }
  }
  useEffect(() => {
    const keyboard = event => {
      if (!source || locked || event.target.closest?.('input, select, textarea')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard)
  })

  return <ToolPage toolId="thumbmark"><div className="thumb-workspace">
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel thumb-upload"><DropZone accept={['image/png', 'image/jpeg', 'image/webp', 'image/bmp', '.png', '.jpg', '.jpeg', '.webp', '.bmp']} onFiles={load}><Fingerprint size={31} /><div className="drop-zone-title">Choose a thumbprint image</div><div className="drop-zone-sub">JPG, PNG, WebP or BMP</div></DropZone><button className="btn btn-secondary" disabled={loading} onClick={() => cameraInput.current?.click()}><Camera size={16} /> Use camera</button></div> : <>
      <div className="thumb-file-bar"><Fingerprint size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{source.width} × {source.height} px</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={14} /> Change image</button><button className="thumb-icon" title="Use camera" aria-label="Use camera" disabled={locked} onClick={() => cameraInput.current?.click()}><Camera size={17} /></button><button className="thumb-icon" title="Close image" aria-label="Close image" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="thumb-layout"><aside className="tool-panel thumb-settings"><fieldset disabled={locked}>
        <h2>Clean up</h2><label className="thumb-check"><input type="checkbox" checked={options.removeBackground} onChange={event => commit({ removeBackground: event.target.checked })} /> Remove background</label>
        <label className="thumb-slider"><span>Background cleanup <b>{options.cleanup}</b></span><input type="range" min={0} max={100} value={options.cleanup} disabled={!options.removeBackground} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => changeRange({ cleanup: Number(event.target.value) })} /></label>
        <label className="thumb-slider"><span>Ink strength <b>{options.strength}%</b></span><input type="range" min={40} max={180} value={options.strength} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => changeRange({ strength: Number(event.target.value) })} /></label>
        <FormGroup label="Colour"><select className="form-select" value={options.colorMode} onChange={event => commit({ colorMode: event.target.value })}><option value="original">Original colours</option><option value="ink">Single ink</option></select></FormGroup>
        {options.colorMode === 'ink' && <div className="thumb-ink-colors">{[['#173f78', 'Blue'], ['#20262c', 'Black'], ['#782b86', 'Purple']].map(([ink, label]) => <button key={ink} style={{ '--ink': ink }} aria-label={`${label} ink`} aria-pressed={options.ink === ink} onClick={() => commit({ ink })} />)}<input aria-label="Custom ink colour" type="color" value={options.ink} onChange={event => commit({ ink: event.target.value })} /></div>}
        <label className="thumb-check"><input type="checkbox" checked={options.trim} onChange={event => commit({ trim: event.target.checked })} /> Trim empty edges</label>
        <details className="thumb-advanced"><summary>Fine adjustments</summary><label className="thumb-slider"><span>Edge softness <b>{options.softness}</b></span><input type="range" min={0} max={100} value={options.softness} disabled={!options.removeBackground} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => changeRange({ softness: Number(event.target.value) })} /></label><label className="thumb-check"><input type="checkbox" checked={options.evenLighting} onChange={event => commit({ evenLighting: event.target.checked })} /> Even out lighting</label><label className="thumb-check"><input type="checkbox" checked={options.invert} onChange={event => commit({ invert: event.target.checked })} /> Light ink on dark background</label></details>
        <details className="thumb-advanced"><summary>Crop margins (%)</summary><div className="thumb-crop-numbers">{['left', 'top', 'right', 'bottom'].map(edge => { const crop = options.crop, value = edge === 'left' ? crop.x : edge === 'top' ? crop.y : edge === 'right' ? 1 - crop.x - crop.width : 1 - crop.y - crop.height; return <FormGroup key={edge} label={edge[0].toUpperCase() + edge.slice(1)}><input className="form-input" type="number" min={0} max={99} step={.1} value={+(Math.max(0, value) * 100).toFixed(1)} onChange={event => changeEdge(edge, event.target.value)} /></FormGroup> })}</div></details>
        <div className="thumb-export-fields"><FormGroup label="Download as"><select className="form-select" value={format} onChange={event => setFormat(event.target.value)}><option value="png">PNG image</option><option value="pdf">PDF</option></select></FormGroup><FormGroup label="Export background"><select className="form-select" value={options.background} onChange={event => commit({ background: event.target.value })}><option value="white">White (opaque)</option><option value="transparent">Transparent</option></select></FormGroup></div>
        {format === 'pdf' && <FormGroup label="PDF width (mm)"><input className="form-input" type="number" min={10} max={60} step={1} value={pdfWidth} onChange={event => setPdfWidth(event.target.value)} /></FormGroup>}
      </fieldset>
      {current && preview.empty && <p className="thumb-error" role="alert">No visible ink. Reduce background cleanup.</p>}
      {format === 'pdf' && !validWidth && <p className="thumb-error" role="alert">Set width between 10 and 60 mm.</p>}
      <button className="btn btn-primary thumb-download" disabled={locked || !current || preview.empty || (format === 'pdf' && !validWidth)} onClick={download}>{exporting ? <LoaderCircle size={17} className="thumb-spin" /> : <Download size={17} />}{exporting ? 'Preparing…' : `Download ${format.toUpperCase()}`}</button>
      {exporting && <button className="thumb-reset" onClick={() => { operation.current?.abort(); operation.current = null; setExporting(false) }}>Cancel export</button>}
      <button className="thumb-reset" disabled={locked} onClick={() => { commit(thumbmarkDefaults()); setMode('result'); setViewerBackground('white') }}><RotateCcw size={12} /> Reset edits</button>
      </aside><section className="thumb-review" aria-label="Thumbmark editor">
        <div className="thumb-preview-tabs" role="group" aria-label="Preview view">{[['result', 'Result'], ['crop', 'Crop'], ['original', 'Original']].map(([value, label]) => <button key={value} disabled={locked} aria-pressed={mode === value} onClick={() => { finish(); setMode(value) }}>{label}</button>)}<span className="thumb-preview-status" role="status">{processing || (!current && !previewFailed) ? <><LoaderCircle size={12} className="thumb-spin" /> Updating…</> : previewFailed ? 'Preview failed' : 'Ready'}</span>{previewFailed && <button disabled={locked} onClick={() => { setError(''); setPreviewRetry(value => value + 1) }}>Retry</button>}</div>
        <div className="thumb-edit-toolbar"><div><button className="thumb-icon" disabled={locked || !history.past.length} aria-label="Undo" title="Undo" onClick={undo}><Undo2 size={16} /></button><button className="thumb-icon" disabled={locked || !history.future.length} aria-label="Redo" title="Redo" onClick={redo}><Redo2 size={16} /></button><span className="thumb-divider" /><button className="thumb-icon" disabled={locked} aria-label="Rotate left" title="Rotate left" onClick={() => rotate(false)}><RotateCcw size={16} /></button><button className="thumb-icon" disabled={locked} aria-label="Rotate right" title="Rotate right" onClick={() => rotate(true)}><RotateCw size={16} /></button><button className="thumb-icon" disabled={locked} aria-label="Flip horizontal" title="Flip horizontal" onClick={() => flip(true)}><FlipHorizontal2 size={16} /></button><button className="thumb-icon" disabled={locked} aria-label="Flip vertical" title="Flip vertical" onClick={() => flip(false)}><FlipVertical2 size={16} /></button></div><div><button className="btn btn-secondary btn-sm" disabled={locked || !current || !preview.bounds} onClick={autoCrop}><Crop size={13} /> Auto crop</button><button className="thumb-icon" title="Use full image" aria-label="Use full image" disabled={locked} onClick={() => { commit({ crop: { x: 0, y: 0, width: 1, height: 1 } }); setMode('crop') }}><Maximize2 size={16} /></button></div></div>
        <ThumbmarkPreview original={original} result={preview} crop={options.crop} onStart={begin} onCrop={cropChange} onEnd={finish} mode={mode} background={viewerBackground} disabled={locked} />
        <div className="thumb-view-footer"><span>Preview background</span><div role="group" aria-label="Preview background">{[['white', 'White'], ['checker', 'Transparent'], ['dark', 'Dark']].map(([value, label]) => <button key={value} className={`thumb-bg-choice bg-${value}`} aria-label={`${label} preview background`} title={`${label} preview only`} aria-pressed={viewerBackground === value} onClick={() => setViewerBackground(value)} />)}</div></div>
      </section></div>
    </>}
    {loading && <p className="thumb-loading" role="status"><LoaderCircle size={16} className="thumb-spin" /> Opening image…</p>}
    {error && <p className="thumb-error" role="alert">{error}</p>}
  </div></ToolPage>
}
