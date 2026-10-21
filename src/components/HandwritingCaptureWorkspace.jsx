import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Camera, ChevronLeft, ChevronRight, Copy, Crop, Download, Eye, GripVertical, ImagePlus, LoaderCircle, Redo2, RotateCcw, RotateCw, Trash2, Undo2, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { ThumbmarkPreview as ImageCropPreview } from './ThumbmarkPreview'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { CAPTURE_PAPERS, captureLayoutDefaults, capturePageDefaults, createHandwritingPhotoPdf, decodeHandwritingPhoto, handwritingPhotoLayout, handwritingSheetPreview, orientHandwritingPhoto, processHandwritingPhoto, readHandwritingPhoto } from '../services/handwritingCapture'
import './ThumbmarkWorkspace.css'
import './HandwritingCaptureWorkspace.css'

const initialHistory = () => ({ past: [], pages: [], future: [] })
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', '.jpg', '.jpeg', '.png', '.webp', '.bmp']
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function PhotoThumbnail({ page, number }) {
  const canvas = useRef(null)
  useEffect(() => {
    let cancelled = false
    const image = new Image(); image.src = page.thumbnail
    image.decode().then(() => {
      if (cancelled || !canvas.current) return
      const processed = processHandwritingPhoto(image, page, 220)
      try { canvas.current.width = processed.width; canvas.current.height = processed.height; canvas.current.getContext('2d').drawImage(processed, 0, 0) }
      finally { processed.width = processed.height = 0 }
    }).catch(() => { if (!cancelled && canvas.current) canvas.current.width = canvas.current.height = 0 })
    return () => { cancelled = true; image.src = '' }
  }, [page])
  return <canvas ref={canvas} role="img" aria-label={`Handwriting page ${number}`} />
}

export function HandwritingCaptureWorkspace() {
  const { showToast } = useApp()
  const [history, setHistory] = useState(initialHistory), [selectedId, setSelectedId] = useState(null), [layout, setLayout] = useState(captureLayoutDefaults)
  const [filename, setFilename] = useState('handwritten-notes'), [mode, setMode] = useState('sheet'), [decoded, setDecoded] = useState(null), [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState(''), [result, setResult] = useState(null)
  const [photoFailure, setPhotoFailure] = useState(null), [photoRetry, setPhotoRetry] = useState(0)
  const input = useRef(null), camera = useRef(null), operation = useRef(null), cached = useRef(null), gesture = useRef(null), dragging = useRef(null)
  const pages = history.pages, selected = pages.find(page => page.id === selectedId) || pages[0], selectedIndex = selected ? pages.indexOf(selected) : 0
  const documentParams = useMemo(() => ({ pages, layout }), [pages, layout]), params = useMemo(() => ({ selected, layout }), [selected, layout])
  const title = filename.trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'handwritten-notes'
  const original = useMemo(() => selected && decoded?.file === selected.file && decoded.canvas.width ? orientHandwritingPhoto(decoded.canvas, selected) : null, [decoded, selected?.file, selected?.rotation])
  const layoutError = useMemo(() => { try { for (const page of pages) handwritingPhotoLayout(page, layout); return '' } catch (failure) { return failure.message } }, [pages, layout])
  const current = preview?.params === params && !preview.error
  const usablePreview = preview?.itemId === selected?.id ? preview : null
  const resultCurrent = result?.params === documentParams && result?.title === title
  const decodeError = photoFailure && photoFailure.file === selected?.file ? photoFailure.message : ''

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!selected) { setDecoded(null); return }
    const file = selected.file, controller = new AbortController(); setPhotoFailure(null); setDecoded(null)
    let loaded
    decodeHandwritingPhoto(file, { signal: controller.signal }).then(value => {
      loaded = value
      if (controller.signal.aborted) { loaded.canvas.width = loaded.canvas.height = 0; return }
      setDecoded({ ...loaded, file })
    }).catch(failure => { if (!controller.signal.aborted) setPhotoFailure({ file, message: failure.message || 'Could not open this photo.' }) })
    return () => { controller.abort(); if (loaded) loaded.canvas.width = loaded.canvas.height = 0 }
  }, [selected?.file, photoRetry])
  useEffect(() => {
    if (!selected || decoded?.file !== selected.file || !decoded.canvas.width) return
    let cancelled = false
    const timer = setTimeout(() => {
      let processed
      try {
        processed = processHandwritingPhoto(decoded.canvas, selected, 1800)
        const canvas = handwritingSheetPreview(processed, selected, layout)
        if (!cancelled) setPreview({ params, itemId: selected.id, canvas })
        else canvas.width = canvas.height = 0
      } catch (failure) { if (!cancelled) setPreview({ params, itemId: selected.id, error: failure.message || 'Could not prepare this page.' }) }
      finally { if (processed) processed.width = processed.height = 0 }
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [params, decoded])

  const invalidate = () => { cached.current = null; setResult(null); setError(''); setMode(previous => previous === 'pdf' ? 'sheet' : previous) }
  const commit = (updates, record = true) => {
    invalidate()
    setHistory(previous => {
      const next = typeof updates === 'function' ? updates(previous.pages) : updates
      return next === previous.pages ? previous : { past: record ? [...previous.past.slice(-23), previous.pages] : previous.past, pages: next, future: [] }
    })
  }
  const begin = () => { if (!gesture.current) gesture.current = pages }
  const finish = () => {
    const initial = gesture.current; gesture.current = null
    if (initial) setHistory(previous => previous.pages === initial ? previous : { ...previous, past: [...previous.past.slice(-23), initial], future: [] })
  }
  const update = (patch, record = true) => {
    if (!selected || busy) return
    commit(currentPages => currentPages.map(page => page.id === selected.id ? { ...page, ...patch } : page), record)
  }
  const undo = () => {
    finish(); invalidate()
    setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), pages: previous.past.at(-1), future: [previous.pages, ...previous.future] } : previous)
  }
  const redo = () => {
    finish(); invalidate()
    setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-23), previous.pages], pages: previous.future[0], future: previous.future.slice(1) } : previous)
  }
  const rotate = clockwise => {
    if (!selected || busy) return
    finish(); const crop = selected.crop
    update({ rotation: (selected.rotation + (clockwise ? 90 : 270)) % 360, crop: clockwise ? { x: Math.max(0, 1 - crop.y - crop.height), y: crop.x, width: crop.height, height: crop.width } : { x: crop.y, y: Math.max(0, 1 - crop.x - crop.width), width: crop.height, height: crop.width } })
  }
  const move = direction => {
    const next = selectedIndex + direction
    if (busy || next < 0 || next >= pages.length) return
    finish(); commit(currentPages => { const output = [...currentPages]; [output[selectedIndex], output[next]] = [output[next], output[selectedIndex]]; return output })
  }
  const reorder = (id, target) => {
    if (busy || id === target) return
    const from = pages.findIndex(page => page.id === id), to = pages.findIndex(page => page.id === target)
    if (from < 0 || to < 0) return
    finish(); commit(currentPages => { const next = [...currentPages], [item] = next.splice(from, 1); next.splice(to, 0, item); return next }); setSelectedId(id)
  }
  const remove = () => {
    if (!selected || busy) return
    finish(); commit(currentPages => currentPages.filter(page => page.id !== selected.id)); setSelectedId(pages[selectedIndex + 1]?.id || pages[selectedIndex - 1]?.id || null)
  }
  const duplicate = () => {
    if (!selected || busy || pages.length >= 100) return
    finish(); const copy = { ...selected, id: crypto.randomUUID(), crop: { ...selected.crop } }
    commit(currentPages => [...currentPages.slice(0, selectedIndex + 1), copy, ...currentPages.slice(selectedIndex + 1)]); setSelectedId(copy.id)
  }
  const add = async incoming => {
    if (operation.current || !incoming.length) return
    finish()
    if (pages.length + incoming.length > 100) { setError('Use up to 100 images per PDF.'); return }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setProgress(0); setStatus('Opening images…')
    const added = [], failures = []
    try {
      for (let index = 0; index < incoming.length; index++) {
        if (controller.signal.aborted) return
        setStatus(`Opening image ${index + 1} of ${incoming.length}…`); setProgress(index / incoming.length * 100)
        try { added.push(await readHandwritingPhoto(incoming[index], controller.signal)) }
        catch (failure) { if (failure.name === 'AbortError') throw failure; failures.push(`${incoming[index].name}: ${failure.message || 'Could not open this image.'}`) }
      }
      if (controller.signal.aborted || operation.current !== controller) return
      if (added.length) { commit(currentPages => [...currentPages, ...added]); setSelectedId(added[0].id); setMode('sheet') }
      if (failures.length) setError(failures.slice(0, 3).join(' '))
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not import these images.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const changeLayout = patch => { invalidate(); setLayout(previous => ({ ...previous, ...patch })) }
  const cropEdge = (edge, value) => {
    const crop = selected.crop; let left = crop.x, top = crop.y, right = crop.x + crop.width, bottom = crop.y + crop.height
    const amount = Number(value) / 100
    if (edge === 'left') left = clamp(amount, 0, right - .01)
    if (edge === 'top') top = clamp(amount, 0, bottom - .01)
    if (edge === 'right') right = clamp(1 - amount, left + .01, 1)
    if (edge === 'bottom') bottom = clamp(1 - amount, top + .01, 1)
    update({ crop: { x: left, y: top, width: right - left, height: bottom - top } })
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const create = async action => {
    if (!pages.length || busy || operation.current || layoutError) return
    finish()
    if (cached.current?.params === documentParams && cached.current.title === title) {
      if (action === 'preview') { setResult(cached.current); setMode('pdf') } else downloadBlob(cached.current.blob, `${title}.pdf`)
      return
    }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setProgress(0); setStatus('Creating PDF…'); setError('')
    try {
      const blob = await createHandwritingPhotoPdf(pages, layout, { signal: controller.signal, title, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      const output = { params: documentParams, title, blob }; cached.current = output; setResult(output)
      if (action === 'preview') setMode('pdf')
      else { downloadBlob(blob, `${title}.pdf`); showToast(`${pages.length}-page handwriting PDF ready.`, 'success') }
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not create this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }

  return <ToolPage toolId="handwriting-to-pdf"><div className="capture-workspace thumb-workspace" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); add(Array.from(event.dataTransfer.files)) } }}>
    <input ref={input} type="file" accept={imageTypes.join(',')} multiple hidden disabled={busy} onChange={event => { add(Array.from(event.target.files)); event.target.value = '' }} />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={event => { add(Array.from(event.target.files)); event.target.value = '' }} />
    {!pages.length ? <div className="tool-panel capture-upload"><DropZone accept={imageTypes} multiple onFiles={add}><ImagePlus size={32} /><div className="drop-zone-title">Choose handwriting photos</div><div className="drop-zone-sub">JPG, PNG, WebP or BMP</div></DropZone><button className="btn btn-secondary" disabled={busy} onClick={() => camera.current?.click()}><Camera size={16} /> Use camera</button>{history.past.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={undo}><Undo2 size={16} /> Undo removal</button>}{history.future.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={redo}><Redo2 size={16} /> Redo</button>}</div> : <>
      <div className="capture-filebar"><strong>{pages.length} {pages.length === 1 ? 'page' : 'pages'}</strong><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} /> Add images</button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => camera.current?.click()}><Camera size={15} /> Camera</button><div className="capture-filebar-export"><button className="btn btn-secondary" disabled={busy || !!layoutError} onClick={() => create('preview')}><Eye size={16} /> Preview PDF</button><button className="btn btn-primary" disabled={busy || !!layoutError} onClick={() => create('download')}>{busy ? <LoaderCircle size={17} className="thumb-spin" /> : <Download size={17} />} Download PDF</button></div></div>
      <div className="capture-grid"><aside className="capture-pages" aria-label="Handwriting pages">{pages.map((page, index) => <div key={page.id} className={`capture-page-card${selected.id === page.id ? ' selected' : ''}`} draggable={!busy} onDragStart={event => { if (busy) return; dragging.current = page.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-createpdf-page', page.id) }} onDragEnd={() => { dragging.current = null }} onDragOver={event => { if (dragging.current && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={event => { if (!dragging.current) return; event.preventDefault(); event.stopPropagation(); reorder(dragging.current, page.id); dragging.current = null }}><button disabled={busy} aria-pressed={selected.id === page.id} title={page.file.name} onClick={() => { finish(); setSelectedId(page.id); setMode(previous => previous === 'pdf' ? 'sheet' : previous) }}><PhotoThumbnail page={page} number={index + 1} /><span><GripVertical size={12} /> Page {index + 1}</span></button></div>)}<button className="capture-add" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={18} /> Add pages</button></aside>
      <section className="capture-review" aria-label="Handwriting image editor"><div className="capture-edit-toolbar"><div><button className="thumb-icon" disabled={busy || !history.past.length} aria-label="Undo page edit" title="Undo" onClick={undo}><Undo2 size={16} /></button><button className="thumb-icon" disabled={busy || !history.future.length} aria-label="Redo page edit" title="Redo" onClick={redo}><Redo2 size={16} /></button><span className="thumb-divider" /><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => rotate(false)}><RotateCcw size={14} /> Left</button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => rotate(true)}><RotateCw size={14} /> Right</button><button className="thumb-icon" disabled={busy || selectedIndex === 0} aria-label="Move page earlier" title="Move earlier" onClick={() => move(-1)}><ArrowUp size={16} /></button><button className="thumb-icon" disabled={busy || selectedIndex === pages.length - 1} aria-label="Move page later" title="Move later" onClick={() => move(1)}><ArrowDown size={16} /></button><button className="thumb-icon" disabled={busy || pages.length >= 100} aria-label="Duplicate page" title="Duplicate" onClick={duplicate}><Copy size={16} /></button><button className="thumb-icon capture-delete" disabled={busy} aria-label="Delete page" title="Delete" onClick={remove}><Trash2 size={16} /></button></div></div>
        <div className="capture-view-tabs" role="group" aria-label="Preview mode">{[['sheet', 'Page'], ['crop', 'Crop'], ['original', 'Original'], ...(resultCurrent ? [['pdf', 'PDF']] : [])].map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => { finish(); setMode(value) }}>{value === 'crop' && <Crop size={13} />}{label}</button>)}<span role="status">{mode === 'pdf' ? '' : decodeError || (preview?.params === params && preview.error) ? 'Preview unavailable' : !current ? <><LoaderCircle size={12} className="thumb-spin" /> Updating…</> : 'Ready'}</span></div>
        {mode === 'pdf' && resultCurrent ? <DocumentPdfPreview blob={result.blob} heading="Handwriting PDF" readyLabel="Matches your download" initialPage={selectedIndex + 1} /> : <ImageCropPreview key={selected.id} original={original} result={usablePreview?.canvas ? usablePreview : null} mode={mode === 'sheet' ? 'result' : mode} crop={selected.crop} onStart={begin} onCrop={(crop, committed = false) => update({ crop }, committed || !gesture.current)} onEnd={finish} background="white" disabled={busy} imageLabel={mode === 'sheet' ? 'Handwriting PDF page preview' : 'Original handwriting photo'} zoomLabel="Handwriting photo zoom" />}
        {preview?.params === params && preview.error && <p className="capture-error" role="alert">{preview.error}</p>}
        {decodeError && <p className="capture-error" role="alert">{decodeError} <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPhotoRetry(value => value + 1)}>Retry</button></p>}
        <div className="capture-navigation"><button className="thumb-icon" aria-label="Previous photo" disabled={busy || selectedIndex === 0} onClick={() => { finish(); setSelectedId(pages[selectedIndex - 1].id) }}><ChevronLeft size={17} /></button><span>Page {selectedIndex + 1} of {pages.length}</span><button className="thumb-icon" aria-label="Next photo" disabled={busy || selectedIndex === pages.length - 1} onClick={() => { finish(); setSelectedId(pages[selectedIndex + 1].id) }}><ChevronRight size={17} /></button></div>
      </section><aside className="tool-panel capture-settings"><fieldset disabled={busy}><legend>Page {selectedIndex + 1}</legend><FormGroup label="Appearance"><select className="form-select" value={selected.appearance} onChange={event => update({ appearance: event.target.value })}><option value="original">Original colours</option><option value="clean">Clean paper</option><option value="gray">Grayscale</option><option value="mono">Black & white</option></select></FormGroup>
        {['brightness', 'contrast', ...(selected.appearance === 'mono' ? ['threshold'] : [])].map(key => <label key={key} className="capture-slider"><span>{key[0].toUpperCase() + key.slice(1)}<b>{selected[key]}</b></span><input aria-label={key} type="range" min={key === 'threshold' ? 60 : -40} max={key === 'threshold' ? 240 : 60} value={selected[key]} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => update({ [key]: Number(event.target.value) }, !gesture.current)} /></label>)}
        <div className="capture-small-actions"><button className="btn btn-secondary btn-sm" onClick={() => { const { appearance, brightness, contrast, threshold } = selected; commit(currentPages => currentPages.map(page => ({ ...page, appearance, brightness, contrast, threshold }))) }}>Apply look to all</button><button className="thumb-icon" aria-label="Reset selected page edits" title="Reset page edits" onClick={() => { finish(); update(capturePageDefaults()) }}><RotateCcw size={14} /></button></div>
        <details className="capture-details"><summary>Crop margins (%)</summary><div className="capture-field-pair">{['left', 'top', 'right', 'bottom'].map(edge => { const crop = selected.crop, value = edge === 'left' ? crop.x : edge === 'top' ? crop.y : edge === 'right' ? 1 - crop.x - crop.width : 1 - crop.y - crop.height; return <FormGroup key={edge} label={edge[0].toUpperCase() + edge.slice(1)}><input className="form-input" type="number" min={0} max={99} step={.1} value={+(Math.max(0, value) * 100).toFixed(1)} onChange={event => { cropEdge(edge, event.target.value); setMode('crop') }} /></FormGroup> })}</div><button className="btn btn-secondary btn-sm" onClick={() => update({ crop: { x: 0, y: 0, width: 1, height: 1 } })}>Full image</button></details>
        <h2>PDF settings</h2><div className="capture-field-pair"><FormGroup label="Paper size"><select className="form-select" value={layout.size} onChange={event => changeLayout({ size: event.target.value })}>{Object.keys(CAPTURE_PAPERS).map(value => <option key={value}>{value}</option>)}<option value="image">Image size</option></select></FormGroup><FormGroup label="Orientation"><select className="form-select" value={layout.orientation} disabled={layout.size === 'image'} onChange={event => changeLayout({ orientation: event.target.value })}><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup></div>
        <div className="capture-field-pair"><FormGroup label="Margin (mm)"><input className="form-input" type="number" min={0} max={30} value={layout.size === 'image' ? 0 : layout.margin} disabled={layout.size === 'image'} onChange={event => changeLayout({ margin: event.target.value })} /></FormGroup><FormGroup label="Image fit"><select className="form-select" value={layout.size === 'image' ? 'fit' : layout.fit} disabled={layout.size === 'image'} onChange={event => changeLayout({ fit: event.target.value })}><option value="fit">Fit whole image</option><option value="fill">Fill (crop edges)</option></select></FormGroup></div>
        <FormGroup label="Quality"><select className="form-select" value={layout.quality} onChange={event => changeLayout({ quality: event.target.value })}><option value="high">High quality</option><option value="small">Smaller file</option><option value="lossless">Lossless encoding</option></select></FormGroup><FormGroup label="PDF name"><input className="form-input" autoComplete="off" maxLength={100} value={filename} onChange={event => { invalidate(); setFilename(event.target.value) }} /></FormGroup>
      </fieldset>{layoutError && <p className="capture-error" role="alert">{layoutError}</p>}</aside></div>
    </>}
    {busy && <div className="capture-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
    {error && <p className="capture-error" role="alert">{error}</p>}
  </div></ToolPage>
}
