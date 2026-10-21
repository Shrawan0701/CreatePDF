import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Download, FileText, ImagePlus, Italic, LoaderCircle, Redo2, RotateCcw, Type, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { readEditorImage } from '../services/pdfEditor'
import { createWatermarkedPdf, readWatermarkSource, validateWatermark, WATERMARK_FONTS, WATERMARK_POSITIONS, watermarkDefaults } from '../services/pdfWatermark'
import { useApp } from '../context/AppContext'
import './WatermarkWorkspace.css'

const initialHistory = () => ({ past: [], options: watermarkDefaults(), future: [] })
const positionLabel = value => value === 'center' ? 'Centre' : value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

export function WatermarkWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(initialHistory), [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [generation, setGeneration] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('watermarked'), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const pdfInput = useRef(null), imageInput = useRef(null), reading = useRef(null), request = useRef(null), saveJob = useRef(null), gesture = useRef(null)
  const options = history.options, locked = loading || saving
  const params = useMemo(() => ({ source, options, image }), [source, options, image])
  const { selection, validationError } = useMemo(() => {
    if (!source) return { selection: [], validationError: '' }
    try { return { selection: validateWatermark(options, source.pageCount, image), validationError: '' } }
    catch (failure) { return { selection: [], validationError: failure.message } }
  }, [params])
  const current = preview?.params === params, failed = failure?.params === params
  const output = preview?.params.source === source ? preview.blob : source?.file
  const displayedBlob = view === 'original' ? source?.file : output

  const start = job => {
    if (!job.promise) job.promise = createWatermarkedPdf(job.params.source, job.params.options, job.params.image, { signal: job.controller.signal, onProgress: (value, label) => { if (!job.controller.signal.aborted) setGeneration({ job, value, label }) } }).then(blob => {
      if (!job.controller.signal.aborted) { setPreview({ params: job.params, blob }); setFailure(null) }
      return blob
    }).catch(failure => { job.failed = true; if (!job.controller.signal.aborted) setFailure({ params: job.params, message: failure.message || 'Could not create this watermark.' }); throw failure })
    return job.promise
  }
  useEffect(() => {
    if (!source || validationError) return
    const existing = request.current
    const job = existing?.params === params && !existing.failed && !existing.controller.signal.aborted ? existing : { params, controller: new AbortController(), promise: null }; request.current = job
    const timer = setTimeout(() => { start(job).catch(() => {}) }, 400)
    return () => { clearTimeout(timer); job.controller.abort(); if (request.current === job) request.current = null }
  }, [params, retry, validationError])
  useEffect(() => () => { request.current?.controller.abort(); reading.current?.controller.abort(); saveJob.current?.abort() }, [])

  const invalidate = () => { setError(''); setView('watermarked') }
  const commit = (updates, record = true) => {
    invalidate()
    setHistory(previous => ({ past: record ? [...previous.past.slice(-39), previous.options] : previous.past, options: typeof updates === 'function' ? updates(previous.options) : { ...previous.options, ...updates }, future: [] }))
  }
  const begin = () => { if (!gesture.current) gesture.current = options }
  const finish = () => {
    const initial = gesture.current; gesture.current = null
    if (initial) setHistory(previous => JSON.stringify(initial) === JSON.stringify(previous.options) ? previous : { ...previous, past: [...previous.past.slice(-39), initial], future: [] })
  }
  const change = updates => commit(updates, !gesture.current)
  const undo = () => { finish(); invalidate(); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), options: previous.past.at(-1), future: [previous.options, ...previous.future] } : previous) }
  const redo = () => { finish(); invalidate(); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-39), previous.options], options: previous.future[0], future: previous.future.slice(1) } : previous) }
  const load = async files => {
    if (!files[0] || reading.current || saveJob.current) return
    const job = { controller: new AbortController() }; reading.current = job; setLoading(true); setError('')
    try {
      const loaded = await readWatermarkSource(files[0], { signal: job.controller.signal })
      if (job.controller.signal.aborted || reading.current !== job) return
      gesture.current = null; setSource(loaded); setPage(1); setPreview(null); setFailure(null); setView('watermarked')
      setHistory(previous => ({ ...initialHistory(), options: { ...previous.options, pagesMode: 'all', range: '' } }))
    } catch (failure) { if (reading.current === job && !job.controller.signal.aborted) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === job) { reading.current = null; setLoading(false) } }
  }
  const loadImage = async file => {
    if (!file || reading.current || saveJob.current) return
    if (file.size > 30 * 1024 * 1024) { setError('Choose a watermark image smaller than 30 MB.'); return }
    const job = { controller: new AbortController() }; reading.current = job; setLoading(true); setError('')
    try {
      const decoded = await readEditorImage(file)
      if (job.controller.signal.aborted || reading.current !== job) return
      setImage({ ...decoded, name: file.name }); setView('watermarked')
    } catch (failure) { if (reading.current === job && !job.controller.signal.aborted) setError(failure.message || 'Could not open this image.') }
    finally { if (reading.current === job) { reading.current = null; setLoading(false) } }
  }
  const close = () => { if (!locked) { request.current?.controller.abort(); setSource(null); setPreview(null); setFailure(null); setError(''); setPage(1) } }
  const cancel = () => {
    reading.current?.controller.abort(); reading.current = null; setLoading(false)
    if (saveJob.current) { saveJob.current.abort(); saveJob.current = null; request.current?.controller.abort(); request.current = null; setSaving(false); setRetry(value => value + 1) }
  }
  const download = async () => {
    if (!source || validationError || locked || saveJob.current) return
    const controller = new AbortController(); saveJob.current = controller; setSaving(true); setError('')
    try {
      let blob = current ? preview.blob : null
      if (!blob) {
        let job = request.current
        if (!job || job.params !== params || job.controller.signal.aborted || failed) { job = { params, controller: new AbortController(), promise: null }; request.current = job }
        blob = await start(job)
      }
      if (controller.signal.aborted || saveJob.current !== controller) return
      downloadBlob(blob, `watermarked-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast('Watermarked PDF ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this PDF.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; setSaving(false) } }
  }

  return <ToolPage toolId="add-watermark"><div className="watermark-workspace">
    <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden disabled={locked} onChange={event => { loadImage(event.target.files?.[0]); event.target.value = '' }} />
    {!source ? <div className="tool-panel watermark-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><Type size={32} /><div className="drop-zone-title">Choose a PDF to watermark</div><div className="drop-zone-sub">Add text or your own logo</div></DropZone></div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => pdfInput.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-primary watermark-download" disabled={locked || !!validationError} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />} Download PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings"><div className="watermark-settings-header"><h2>Watermark</h2><button className="icon-btn" disabled={locked || !history.past.length} aria-label="Undo watermark settings" title="Undo settings" onClick={undo}><Undo2 size={15} /></button><button className="icon-btn" disabled={locked || !history.future.length} aria-label="Redo watermark settings" title="Redo settings" onClick={redo}><Redo2 size={15} /></button><button className="icon-btn" disabled={locked} aria-label="Reset watermark settings" title="Reset settings" onClick={() => { finish(); commit(watermarkDefaults()) }}><RotateCcw size={15} /></button></div><fieldset disabled={locked}>
        <div className="watermark-type" role="group" aria-label="Watermark type">{[['text', 'Text', Type], ['image', 'Image', ImagePlus]].map(([type, label, Icon]) => <button key={type} aria-pressed={options.type === type} onClick={() => change({ type, rotation: type === 'image' ? 0 : 45 })}><Icon size={15} />{label}</button>)}</div>
        {options.type === 'text' ? <><FormGroup label="Watermark text"><textarea className="form-textarea watermark-text" value={options.text} maxLength={500} rows={2} onChange={event => change({ text: event.target.value })} /></FormGroup><div className="watermark-presets">{['CONFIDENTIAL', 'DRAFT', 'SAMPLE'].map(text => <button key={text} onClick={() => change({ text })}>{text}</button>)}</div><div className="watermark-font-row"><FormGroup label="Font"><select className="form-select" value={options.font} onChange={event => change({ font: event.target.value })}>{WATERMARK_FONTS.map(font => <option key={font}>{font}</option>)}</select></FormGroup><button className={`btn btn-sm ${options.bold ? 'btn-primary' : 'btn-secondary'}`} aria-label="Bold watermark" aria-pressed={options.bold} onClick={() => change({ bold: !options.bold })}><Bold size={15} /></button><button className={`btn btn-sm ${options.italic ? 'btn-primary' : 'btn-secondary'}`} aria-label="Italic watermark" aria-pressed={options.italic} onClick={() => change({ italic: !options.italic })}><Italic size={15} /></button></div><div className="watermark-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={8} max={144} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Colour"><div className="watermark-colour"><input type="color" aria-label="Watermark text colour" value={options.color} onChange={event => change({ color: event.target.value })} /><span>{options.color.toUpperCase()}</span></div></FormGroup></div></> : <div className="watermark-image-picker">{image ? <><img src={image.dataUrl} alt="Watermark logo" /><span title={image.name}>{image.name}</span><div><button className="btn btn-secondary btn-sm" onClick={() => imageInput.current?.click()}>Change image</button><button className="icon-btn" title="Remove image" aria-label="Remove watermark image" onClick={() => { setImage(null); invalidate() }}><X size={15} /></button></div></> : <button className="watermark-image-upload" onClick={() => imageInput.current?.click()}><ImagePlus size={24} />Choose PNG, JPG or WebP</button>}<label className="watermark-slider"><span>Image width <b>{options.imageWidth}%</b></span><input type="range" min={5} max={90} value={options.imageWidth} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => change({ imageWidth: Number(event.target.value) })} /></label></div>}
        <label className="watermark-slider"><span>Opacity <b>{options.opacity}%</b></span><input type="range" min={1} max={100} value={options.opacity} onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onChange={event => change({ opacity: Number(event.target.value) })} /></label>
        <div className="watermark-angle"><span>Rotation</span>{[0, 45, -45, 90].map(rotation => <button key={rotation} aria-pressed={Number(options.rotation) === rotation} onClick={() => change({ rotation })}>{rotation}°</button>)}<input className="form-input" aria-label="Watermark rotation in degrees" type="number" min={-180} max={180} value={options.rotation} onChange={event => change({ rotation: event.target.value })} /></div>
        <div className="watermark-position-row"><span>Position</span><div className="watermark-position-grid" role="group" aria-label="Watermark position">{WATERMARK_POSITIONS.map(position => <button key={position} disabled={options.repeat} aria-label={positionLabel(position)} title={positionLabel(position)} aria-pressed={options.position === position} onClick={() => change({ position })}><span /></button>)}</div><label className="watermark-check"><input type="checkbox" checked={options.repeat} onChange={event => change({ repeat: event.target.checked })} /> Repeat across page</label></div>
        <FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Page range</option></select></FormGroup>{options.pagesMode === 'custom' && <FormGroup label="Pages"><input className="form-input" placeholder="1-3, 5" value={options.range} onChange={event => change({ range: event.target.value })} /></FormGroup>}
        <details className="watermark-advanced"><summary>More settings</summary><div className="watermark-field-pair"><FormGroup label="Edge margin (mm)"><input className="form-input" type="number" min={0} max={50} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup><FormGroup label="Layer"><select className="form-select" value={options.layer} onChange={event => change({ layer: event.target.value })}><option value="over">Over content</option><option value="under">Behind content</option></select></FormGroup></div><label className="watermark-check"><input type="checkbox" checked={options.autoFit} onChange={event => change({ autoFit: event.target.checked })} /> Fit within page</label>{options.repeat ? <FormGroup label="Tile spacing (mm)"><input className="form-input" type="number" min={5} max={100} value={options.gap} onChange={event => change({ gap: event.target.value })} /></FormGroup> : <><button className="watermark-inline-button" aria-pressed={options.position === 'custom'} onClick={() => change({ position: options.position === 'custom' ? 'center' : 'custom' })}>Custom position</button>{options.position === 'custom' && <div className="watermark-field-pair"><FormGroup label="From left (%)"><input className="form-input" type="number" min={0} max={100} value={options.x} onChange={event => change({ x: event.target.value })} /></FormGroup><FormGroup label="From top (%)"><input className="form-input" type="number" min={0} max={100} value={options.y} onChange={event => change({ y: event.target.value })} /></FormGroup></div>}</>}{options.type === 'text' && <span className="watermark-token-hint">Text supports {'{page}'} and {'{total}'}.</span>}</details>
      </fieldset>{validationError && <p className="watermark-error" role="alert">{validationError}</p>}{failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry watermark</button></p>}</aside>
      <section className="watermark-review" aria-label="Watermark preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'watermarked'} onClick={() => setView('watermarked')}>Watermarked</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span>{selection.length} of {source.pageCount} pages</span></div><WatermarkPdfPreview blob={displayedBlob} page={page} pageCount={source.pageCount} onPage={setPage} updating={view === 'watermarked' && !current && !validationError && !failed} error={view === 'watermarked' && failed ? failure.message : ''} />{view === 'watermarked' && selection.length > 0 && !selection.includes(page) && <p className="watermark-page-note">This page is outside the selected range.</p>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={saving && generation?.job.params === params ? generation.value : null} label={saving ? generation?.job.params === params ? generation.label : 'Preparing PDF…' : 'Opening file…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
