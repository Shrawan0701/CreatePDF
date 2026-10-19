import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Crop, Download, FileText, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { CropResizePreview } from './CropResizePreview'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob } from './ui'
import { readSplitSource } from '../services/pdfSplit'
import { buildCropResizePlan, createCropResizePdf, CROP_PAPERS, cropResizeDefaults } from '../services/pdfCropResize'
import { useApp } from '../context/AppContext'
import './CropResizeWorkspace.css'

const sides = ['top', 'bottom', 'left', 'right']
const millimeters = points => (points * 25.4 / 72).toLocaleString(undefined, { maximumFractionDigits: 1 })

export function CropResizeWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null), [options, setOptions] = useState(cropResizeDefaults)
  const [page, setPage] = useState(1), [view, setView] = useState('crop'), [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(0), [status, setStatus] = useState('')
  const reading = useRef(null), operation = useRef(null), input = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])
  const { plan, planError } = useMemo(() => {
    if (!source) return { plan: null, planError: '' }
    try { return { plan: buildCropResizePlan(source, options), planError: '' } }
    catch (failure) { return { plan: null, planError: failure.message } }
  }, [source, options])
  const current = plan?.pages[page - 1], cropping = options.mode !== 'resize', resizing = options.mode !== 'crop', locked = loading || busy
  const insets = Object.fromEntries(sides.map(side => [side, Number(options[side]) / 100]))
  const validEdges = sides.every(side => Number.isFinite(insets[side]) && insets[side] >= 0) && insets.left + insets.right <= .980001 && insets.top + insets.bottom <= .980001
  const edges = validEdges ? insets : { left: 0, top: 0, right: 0, bottom: 0 }
  const invalidate = () => { operation.current?.abort(); operation.current = null; setBusy(false); setResult(null); setError(''); setProgress(0); setStatus('') }
  const change = updates => {
    invalidate(); setOptions(previous => ({ ...previous, ...updates }))
    if (updates.mode) setView(updates.mode === 'resize' ? 'result' : 'crop')
    else if (view === 'pdf') setView('result')
  }
  const crop = values => change(Object.fromEntries(sides.map(side => [side, Number((values[side] * 100).toFixed(2))])))
  const preset = value => change(Object.fromEntries(sides.map(side => [side, value])))
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); invalidate()
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setPage(1); setLoading(true); setView(options.mode === 'resize' ? 'result' : 'crop'); setOptions(previous => ({ ...previous, range: '' }))
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (reading.current === controller && !controller.signal.aborted) setSource(loaded)
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false) } }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; invalidate()
    setFile(null); setSource(null); setPage(1); setLoading(false); setOptions(cropResizeDefaults()); setView('crop')
  }
  const downloadName = () => `${file.name.replace(/\.pdf$/i, '')}-${options.mode === 'crop' ? 'cropped' : options.mode === 'resize' ? 'resized' : 'cropped-resized'}.pdf`
  const download = async () => {
    if (!source || !plan || locked || operation.current) return
    if (result?.plan === plan) { downloadBlob(result.blob, downloadName()); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing PDF')
    try {
      const created = await createCropResizePdf(source, plan, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setResult({ ...created, plan }); setView('pdf'); downloadBlob(created.blob, downloadName()); showToast('PDF downloaded.', 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not save this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setStatus('Cancelled'); setProgress(0) }

  return <ToolPage toolId="crop-resize"><div className="crop-workspace">
    <input ref={input} type="file" hidden accept="application/pdf,.pdf" onChange={event => { choose(Array.from(event.target.files)); event.target.value = '' }} />
    {!file ? <div className="tool-panel crop-upload"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']}><Crop size={29} /><div><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Drop it here or click to browse</div></div></DropZone></div> : <div className="crop-file-bar"><FileText size={18} /><strong title={file.name}>{file.name}</strong><span>{source ? `${source.pageCount} pages` : loading ? 'Opening…' : 'Could not open'}</span><div><button className="btn btn-primary" disabled={!plan || locked} onClick={download}>{busy ? <LoaderCircle size={16} className="crop-spin" /> : <Download size={16} />}{busy ? 'Saving…' : 'Download PDF'}</button>{busy ? <button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button> : <><button className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" onClick={reset} title="Start over" aria-label="Start over"><X size={16} /></button></>}</div></div>}
    {busy && <div className="crop-export-progress"><ProgressBar value={progress} label={status} /></div>}
    <div className="crop-workspace-layout"><aside className="tool-panel crop-settings">
      <div className="crop-mode-options" role="group" aria-label="Operation">{[['crop', 'Crop'], ['resize', 'Resize'], ['both', 'Crop & resize']].map(([mode, label]) => <button key={mode} disabled={locked} aria-pressed={options.mode === mode} onClick={() => change({ mode })}>{label}</button>)}</div>
      {cropping && <section className="crop-settings-section"><h2>Crop margins <span>%</span></h2><div className="crop-field-pair">{sides.map(side => <FormGroup key={side} label={side[0].toUpperCase() + side.slice(1)}><input className="form-input" type="number" inputMode="decimal" min={0} max={98} step={.5} value={options[side]} disabled={locked} onChange={event => change({ [side]: event.target.value })} /></FormGroup>)}</div><div className="crop-margin-presets" aria-label="Crop margins presets">{[0, 2, 5, 10].map(value => <button key={value} disabled={locked} aria-pressed={sides.every(side => Number(options[side]) === value)} onClick={() => preset(value)}>{value ? `${value}%` : 'Reset crop'}</button>)}</div><p className="crop-small-note">Cropping hides content; it does not erase it.</p></section>}
      {resizing && <section className="crop-settings-section"><h2>Page size</h2><div className={`crop-field-pair${options.paper === 'custom' ? ' custom-paper' : ''}`}><FormGroup label="Paper size"><select className="form-select" value={options.paper} disabled={locked} onChange={event => change({ paper: event.target.value })}>{Object.keys(CROP_PAPERS).map(paper => <option key={paper}>{paper}</option>)}<option value="custom">Custom</option></select></FormGroup>{options.paper !== 'custom' && <FormGroup label="Orientation"><select className="form-select" value={options.orientation} disabled={locked} onChange={event => change({ orientation: event.target.value })}><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>}</div>{options.paper === 'custom' && <div className="crop-field-pair"><FormGroup label="Width (mm)"><input className="form-input" type="number" min={10} max={2000} step={1} disabled={locked} value={options.width} onChange={event => change({ width: event.target.value })} /></FormGroup><FormGroup label="Height (mm)"><input className="form-input" type="number" min={10} max={2000} step={1} disabled={locked} value={options.height} onChange={event => change({ height: event.target.value })} /></FormGroup></div>}<div className="crop-field-pair"><FormGroup label="Content fit"><select className="form-select" value={options.fit} disabled={locked} onChange={event => change({ fit: event.target.value })}><option value="contain">Fit inside</option><option value="cover">Fill (crop overflow)</option></select></FormGroup><FormGroup label="Margin (mm)"><input className="form-input" type="number" min={0} max={100} step={1} disabled={locked} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup></div></section>}
      <section className="crop-settings-section"><FormGroup label="Apply to pages"><input className="form-input" value={options.range} disabled={locked} autoComplete="off" placeholder="All pages · or 1-3, 5" onChange={event => change({ range: event.target.value })} /></FormGroup><div className="crop-scope-actions"><button disabled={locked} aria-pressed={!options.range.trim()} onClick={() => change({ range: '' })}>All pages</button><button disabled={locked || !source} aria-pressed={options.range.trim() === String(page)} onClick={() => change({ range: String(page) })}>This page</button></div></section>
      {current && <div className="crop-size-summary" aria-live="polite"><span>{millimeters(current.original.width)} × {millimeters(current.original.height)} mm</span><ArrowRight size={14} /><strong>{millimeters(current.width)} × {millimeters(current.height)} mm</strong><small>{plan.selectedCount} {plan.selectedCount === 1 ? 'page selected' : 'pages selected'}</small></div>}
      {planError && <p className="crop-error" role="alert">{planError}</p>}{error && <p className="crop-error" role="alert">{error}</p>}
      <button className="crop-reset-settings" disabled={locked} onClick={() => { invalidate(); setOptions(cropResizeDefaults()); setView('crop') }}><RotateCcw size={12} /> Reset settings</button>
    </aside><div className="crop-review">
      <div className="crop-preview-tabs" aria-label="Preview mode"><button aria-pressed={view === 'crop'} onClick={() => setView('crop')}>{cropping ? 'Crop area' : 'Original'}</button><button aria-pressed={view === 'result'} disabled={!plan} onClick={() => setView('result')}>Result</button>{result && <button aria-pressed={view === 'pdf'} onClick={() => setView('pdf')}>Exported PDF</button>}</div>
      {loading && <p className="crop-opening" role="status"><LoaderCircle size={15} className="crop-spin" /> Opening PDF…</p>}
      {view === 'pdf' && result ? <DocumentPdfPreview blob={result.blob} heading="Exported PDF" readyLabel="Matches your download" initialPage={page} /> : <CropResizePreview source={source} placement={current} pageNumber={page} onPage={setPage} view={view} cropping={cropping} edges={edges} onCrop={crop} disabled={locked || !validEdges} />}
    </div></div>
  </div></ToolPage>
}
