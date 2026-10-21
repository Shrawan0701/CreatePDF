import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle, Moon, Redo2, RotateCcw, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { COLOUR_MODES, colourDefaults, createColourPdf, readColourSource, validateColours } from '../services/pdfColours'
import './WatermarkWorkspace.css'
import './InvertColoursWorkspace.css'

const initialHistory = () => ({ past: [], options: colourDefaults(), future: [] })
const swatches = { dark: ['#202328', '#e5e7eb'], invert: ['#000000', '#ffffff'], sepia: ['#f6ecd8', '#72532d'], grayscale: ['#e5e5e5', '#444444'], light: ['#ffffff', '#262626'], contrast: ['#ffffff', '#000000'] }

export function InvertColoursWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(initialHistory)
  const [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [generation, setGeneration] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('converted'), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const input = useRef(null), reading = useRef(null), request = useRef(null), saveJob = useRef(null)
  const options = history.options, locked = loading || saving, params = useMemo(() => ({ source, options }), [source, options])
  const { selection, validationError } = useMemo(() => {
    if (!source) return { selection: [], validationError: '' }
    try { return { selection: validateColours(options, source.pageCount), validationError: '' } }
    catch (failure) { return { selection: [], validationError: failure.message } }
  }, [source, options])
  const current = preview?.params === params, failed = failure?.params === params
  const output = preview && preview.params.source === source ? preview.result.blob : source?.file
  const displayed = view === 'original' ? source?.file : output, result = current ? preview.result : null

  const start = job => {
    if (!job.promise) {
      setFailure(previous => previous?.params === job.params ? null : previous)
      job.promise = createColourPdf(job.params.source, job.params.options, {
        signal: job.controller.signal,
        onProgress: (value, label) => { if (!job.controller.signal.aborted) setGeneration({ job, value, label }) },
      }).then(result => {
        if (!job.controller.signal.aborted) { setPreview({ params: job.params, result }); setFailure(null) }
        return result
      }).catch(failure => {
        job.failed = true
        if (!job.controller.signal.aborted) setFailure({ params: job.params, message: failure.message || 'Could not convert this PDF.' })
        throw failure
      })
    }
    return job.promise
  }
  useEffect(() => {
    if (!source || validationError) return
    const existing = request.current
    const job = existing?.params === params && !existing.failed && !existing.controller.signal.aborted ? existing : { params, controller: new AbortController(), promise: null }
    request.current = job
    const timer = setTimeout(() => { start(job).catch(() => {}) }, 400)
    return () => { clearTimeout(timer); job.controller.abort(); if (request.current === job) request.current = null }
  }, [params, retry, validationError])
  useEffect(() => () => { request.current?.controller.abort(); reading.current?.abort(); saveJob.current?.abort() }, [])

  const change = update => {
    setView('converted'); setError('')
    setHistory(previous => {
      const next = { ...previous.options, ...update }
      if (Object.keys(next).every(key => next[key] === previous.options[key])) return previous
      return { past: [...previous.past.slice(-39), previous.options], options: next, future: [] }
    })
  }
  const undo = () => { setError(''); setView('converted'); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), options: previous.past.at(-1), future: [previous.options, ...previous.future] } : previous) }
  const redo = () => { setError(''); setView('converted'); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-39), previous.options], options: previous.future[0], future: previous.future.slice(1) } : previous) }
  const load = async files => {
    if (!files[0] || reading.current || saveJob.current) return
    const controller = new AbortController(); reading.current = controller; setLoading(true); setError('')
    try {
      const loaded = await readColourSource(files[0], { signal: controller.signal })
      if (controller.signal.aborted || reading.current !== controller) return
      request.current?.controller.abort(); setSource(loaded); setPage(1); setPreview(null); setFailure(null); setGeneration(null); setView('converted')
      setHistory(previous => ({ past: [], options: { ...previous.options, pagesMode: 'all', range: '' }, future: [] }))
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false) } }
  }
  const close = () => { if (!locked) { request.current?.controller.abort(); setSource(null); setPreview(null); setFailure(null); setGeneration(null); setError(''); setPage(1) } }
  const cancel = () => {
    reading.current?.abort(); reading.current = null; setLoading(false)
    if (saveJob.current) { saveJob.current.abort(); saveJob.current = null; request.current?.controller.abort(); request.current = null; setSaving(false); setRetry(value => value + 1) }
  }
  const download = async () => {
    if (!source || validationError || locked || saveJob.current) return
    const controller = new AbortController(); saveJob.current = controller; setSaving(true); setError('')
    try {
      let output = current ? preview.result : null
      if (!output) {
        let job = request.current
        if (!job || job.params !== params || job.controller.signal.aborted || job.failed) { job = { params, controller: new AbortController(), promise: null }; request.current = job }
        output = await start(job)
      }
      if (controller.signal.aborted || saveJob.current !== controller) return
      downloadBlob(output.blob, `${options.mode}-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast('Colour-adjusted PDF ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this PDF.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; setSaving(false) } }
  }

  return <ToolPage toolId="invert-colors"><div className="invert-colours-workspace">
    <input ref={input} hidden type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel watermark-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><Moon size={32} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Preview dark, sepia and other colour modes</div></DropZone></div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-primary watermark-download" disabled={locked || !!validationError} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />} Download PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings"><div className="watermark-settings-header"><h2>Page colours</h2><button className="icon-btn" disabled={locked || !history.past.length} aria-label="Undo colour settings" title="Undo" onClick={undo}><Undo2 size={15} /></button><button className="icon-btn" disabled={locked || !history.future.length} aria-label="Redo colour settings" title="Redo" onClick={redo}><Redo2 size={15} /></button><button className="icon-btn" disabled={locked} aria-label="Reset colour settings" title="Reset settings" onClick={() => change(colourDefaults())}><RotateCcw size={15} /></button></div>
        <fieldset disabled={locked}>
          <div className="colour-presets" role="group" aria-label="Colour preset">{Object.entries(COLOUR_MODES).map(([mode, label]) => <button key={mode} aria-pressed={options.mode === mode} onClick={() => change({ mode, method: mode === 'contrast' ? 'image' : 'preserve', encoding: mode === 'contrast' ? 'png' : options.encoding })}><span className={`colour-swatch colour-swatch-${mode}`} style={{ background: mode === 'dark' ? options.paper : swatches[mode][0], color: mode === 'dark' ? options.ink : swatches[mode][1] }}>Aa</span><span>{label}</span></button>)}</div>
          {options.mode === 'dark' && <div className="watermark-field-pair"><FormGroup label="Paper"><div className="colour-picker"><input type="color" aria-label="Dark paper colour" value={options.paper} onChange={event => change({ paper: event.target.value })} /><span>{options.paper.toUpperCase()}</span></div></FormGroup><FormGroup label="Light text"><div className="colour-picker"><input type="color" aria-label="Light text colour" value={options.ink} onChange={event => change({ ink: event.target.value })} /><span>{options.ink.toUpperCase()}</span></div></FormGroup></div>}
          {options.mode === 'light' && <p className="colour-small colour-mode-hint">Dark pages are inverted; pages with light backgrounds stay unchanged.</p>}
          {options.mode === 'contrast' && <FormGroup label="Black / white threshold"><input className="form-input" type="number" min={32} max={224} value={options.threshold} onChange={event => change({ threshold: event.target.value })} /></FormGroup>}
          <FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Page range</option></select></FormGroup>
          {options.pagesMode === 'custom' && <FormGroup label="Pages"><input className="form-input" placeholder="1-3, 5" value={options.range} onChange={event => change({ range: event.target.value })} /></FormGroup>}
          <FormGroup label="Export method"><select className="form-select" value={options.method} onChange={event => change({ method: event.target.value })}><option value="preserve" disabled={options.mode === 'contrast'}>Keep text &amp; graphics</option><option value="image">Image pages</option></select></FormGroup>
          {options.method === 'image' && <div className="watermark-field-pair"><FormGroup label="Resolution"><select className="form-select" value={options.dpi} onChange={event => change({ dpi: Number(event.target.value) })}><option value={150}>150 DPI</option><option value={200}>200 DPI</option><option value={300}>300 DPI</option></select></FormGroup><FormGroup label="Images"><select className="form-select" value={options.encoding} onChange={event => change({ encoding: event.target.value })}><option value="jpeg">JPG · smaller</option><option value="png">PNG · lossless</option></select></FormGroup></div>}
          {source.inventory.length > 0 && <label className="colour-flatten"><input type="checkbox" checked={options.flatten} onChange={event => change({ flatten: event.target.checked })} /><div>Include fields &amp; annotations<span>Makes selected fields and annotations static.</span></div></label>}
        </fieldset>
        <p className="colour-small">{options.method === 'preserve' ? 'Text stays selectable. Graphics and links are retained.' : 'Selected page content becomes images. Links are retained.'}</p>
        {source.inventory.length > 0 && !options.flatten && <p className="colour-small">Interactive fields and annotations keep their original colours.</p>}
        {source.signatures > 0 && <p className="colour-small">Editing this signed PDF invalidates its digital signatures.</p>}
        {result && <div className="colour-result" role="status"><strong>{result.changed ? `${result.changed} pages converted` : 'No colour changes needed'}</strong>{result.skipped > 0 && <span>{result.skipped} pages already have light backgrounds</span>}{result.flattened > 0 && <span>{result.flattened} fields and annotations made static</span>}<span>{formatBytes(result.blob.size)} output</span></div>}
        {validationError && <p className="watermark-error" role="alert">{validationError}</p>}
        {failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry conversion</button></p>}
      </aside><section className="watermark-review" aria-label="Colour PDF preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'converted'} onClick={() => setView('converted')}>{COLOUR_MODES[options.mode]}</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span>{selection.length} of {source.pageCount} pages</span></div><WatermarkPdfPreview blob={displayed} page={page} pageCount={source.pageCount} onPage={setPage} label="Colour PDF" updatingLabel="Updating colours…" updating={view === 'converted' && !current && !validationError && !failed} error={view === 'converted' && failed ? failure.message : ''} />{view === 'converted' && selection.length > 0 && !selection.includes(page) && <div className="watermark-page-note">This page keeps its original colours.<button className="colour-jump" onClick={() => setPage(selection[0])}>Go to first included page</button></div>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={saving && generation?.job.params === params ? generation.value : null} label={saving ? generation?.job.params === params ? generation.label : 'Preparing PDF…' : 'Reading PDF…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
