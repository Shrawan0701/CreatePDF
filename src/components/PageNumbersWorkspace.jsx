import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Download, FileText, Hash, Italic, LoaderCircle, Redo2, RotateCcw, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { useApp } from '../context/AppContext'
import { createNumberedPdf, formatPageNumber, NUMBER_FORMATS, NUMBER_POSITIONS, NUMBER_STYLES, pageNumberDefaults, pageNumberLabel, readPageNumberSource, validatePageNumbers } from '../services/pdfPageNumbers'
import { WATERMARK_FONTS } from '../services/pdfWatermark'
import './WatermarkWorkspace.css'
import './PageNumbersWorkspace.css'

const initialHistory = () => ({ past: [], options: pageNumberDefaults(), future: [] })
const positionLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const formatLabels = { number: '1', page: 'Page 1', fraction: '1 / 10', full: 'Page 1 of 10', custom: 'Custom format' }

export function PageNumbersWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(initialHistory)
  const [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [generation, setGeneration] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('numbered'), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const input = useRef(null), reading = useRef(null), request = useRef(null), saveJob = useRef(null)
  const options = history.options, locked = loading || saving
  const params = useMemo(() => ({ source, options }), [source, options])
  const { plan, validationError } = useMemo(() => {
    if (!source) return { plan: null, validationError: '' }
    try { return { plan: validatePageNumbers(options, source.pageCount), validationError: '' } }
    catch (failure) { return { plan: null, validationError: failure.message } }
  }, [source, options])
  const current = preview?.params === params, failed = failure?.params === params
  const output = preview && preview.params.source === source ? preview.blob : source?.file
  const displayedBlob = view === 'original' ? source?.file : output
  const pageLabel = plan ? pageNumberLabel(options, plan, page, source.pageCount) : ''

  const start = job => {
    if (!job.promise) job.promise = createNumberedPdf(job.params.source, job.params.options, {
      signal: job.controller.signal,
      onProgress: (value, label) => { if (!job.controller.signal.aborted) setGeneration({ job, value, label }) },
    }).then(blob => {
      if (!job.controller.signal.aborted) { setPreview({ params: job.params, blob }); setFailure(null) }
      return blob
    }).catch(failure => {
      job.failed = true
      if (!job.controller.signal.aborted) setFailure({ params: job.params, message: failure.message || 'Could not add page numbers.' })
      throw failure
    })
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

  const change = updates => {
    setError(''); setView('numbered')
    setHistory(previous => {
      const next = typeof updates === 'function' ? updates(previous.options) : { ...previous.options, ...updates }
      if (Object.keys(next).every(key => next[key] === previous.options[key])) return previous
      return { past: [...previous.past.slice(-39), previous.options], options: next, future: [] }
    })
  }
  const undo = () => { setError(''); setView('numbered'); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), options: previous.past.at(-1), future: [previous.options, ...previous.future] } : previous) }
  const redo = () => { setError(''); setView('numbered'); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-39), previous.options], options: previous.future[0], future: previous.future.slice(1) } : previous) }
  const load = async files => {
    if (!files[0] || reading.current || saveJob.current) return
    const controller = new AbortController(); reading.current = controller; setLoading(true); setError('')
    try {
      const loaded = await readPageNumberSource(files[0], { signal: controller.signal })
      if (controller.signal.aborted || reading.current !== controller) return
      request.current?.controller.abort(); setSource(loaded); setPage(1); setPreview(null); setFailure(null); setGeneration(null); setView('numbered')
      setHistory(previous => ({ ...initialHistory(), options: { ...previous.options, firstPage: 1, pagesMode: 'all', range: '' } }))
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
      let blob = current ? preview.blob : null
      if (!blob) {
        let job = request.current
        if (!job || job.params !== params || job.controller.signal.aborted || job.failed) { job = { params, controller: new AbortController(), promise: null }; request.current = job }
        blob = await start(job)
      }
      if (controller.signal.aborted || saveJob.current !== controller) return
      downloadBlob(blob, `numbered-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast('Numbered PDF ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this PDF.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; setSaving(false) } }
  }

  return <ToolPage toolId="page-numbers"><div className="page-numbers-workspace">
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel watermark-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><Hash size={32} /><div className="drop-zone-title">Choose a PDF to number</div><div className="drop-zone-sub">or drop it here</div></DropZone></div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-primary watermark-download" disabled={locked || !!validationError} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />} Download PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings"><div className="watermark-settings-header"><h2>Page numbers</h2><button className="icon-btn" disabled={locked || !history.past.length} aria-label="Undo numbering settings" title="Undo settings" onClick={undo}><Undo2 size={15} /></button><button className="icon-btn" disabled={locked || !history.future.length} aria-label="Redo numbering settings" title="Redo settings" onClick={redo}><Redo2 size={15} /></button><button className="icon-btn" disabled={locked} aria-label="Reset numbering settings" title="Reset settings" onClick={() => change(pageNumberDefaults())}><RotateCcw size={15} /></button></div>
        <fieldset disabled={locked}>
          <FormGroup label="Format"><div className="number-format-presets" role="group" aria-label="Number format">{Object.keys(NUMBER_FORMATS).map(format => <button key={format} aria-pressed={options.format === format} onClick={() => change({ format })}>{formatLabels[format]}</button>)}<button className="number-custom-format" aria-pressed={options.format === 'custom'} onClick={() => change({ format: 'custom' })}>Custom format</button></div></FormGroup>
          {options.format === 'custom' && <FormGroup label="Custom format" hint="{number} = label · {total} = last number"><input className="form-input" value={options.template} maxLength={200} onChange={event => change({ template: event.target.value })} /><div className="number-token-buttons">{['{number}', '{total}', '{page}', '{pages}'].map(token => <button key={token} title={token === '{page}' ? 'Physical PDF page' : token === '{pages}' ? 'Total PDF pages' : token === '{total}' ? 'Last number in sequence' : 'Formatted page number'} onClick={() => change({ template: options.template + token })}>{token}</button>)}</div></FormGroup>}
          <div className="watermark-field-pair"><FormGroup label="Number style"><select className="form-select" value={options.numberStyle} onChange={event => change({ numberStyle: event.target.value })}>{Object.entries(NUMBER_STYLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormGroup><FormGroup label="Start number"><input className="form-input" type="number" step={1} min={options.numberStyle === 'decimal' || options.numberStyle === 'padded' ? 0 : 1} max={999999999} value={options.startAt} onChange={event => change({ startAt: event.target.value })} /></FormGroup></div>
          <div className="number-position-block"><span>Position</span><div className="number-position-page" role="group" aria-label="Page number position">{NUMBER_POSITIONS.map(position => <button key={position} aria-label={positionLabel(position)} title={positionLabel(position)} aria-pressed={options.position === position} onClick={() => change({ position })}><Hash size={13} /></button>)}<div aria-hidden="true"><i /><i /><i /></div></div><span className="number-position-label">{positionLabel(options.position)}</span></div>
          <div className="watermark-field-pair"><FormGroup label="First numbered page"><input className="form-input" type="number" step={1} min={1} max={source.pageCount} value={options.firstPage} onChange={event => change({ firstPage: event.target.value })} /></FormGroup><FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Page range</option></select></FormGroup></div>
          <label className="watermark-check"><input type="checkbox" disabled={source.pageCount < 2} checked={Number(options.firstPage) > 1} onChange={event => change({ firstPage: event.target.checked ? 2 : 1 })} /> Skip cover page</label>
          {options.pagesMode === 'custom' && <FormGroup label="Pages"><input className="form-input" placeholder="2-5, 8" value={options.range} onChange={event => change({ range: event.target.value })} /></FormGroup>}
          <details className="watermark-advanced"><summary>Font &amp; spacing</summary>
            <div className="watermark-font-row"><FormGroup label="Font"><select className="form-select" value={options.font} onChange={event => change({ font: event.target.value })}>{WATERMARK_FONTS.map(font => <option key={font}>{font}</option>)}</select></FormGroup><button className={`btn btn-sm ${options.bold ? 'btn-primary' : 'btn-secondary'}`} aria-label="Bold numbers" aria-pressed={options.bold} onClick={() => change({ bold: !options.bold })}><Bold size={15} /></button><button className={`btn btn-sm ${options.italic ? 'btn-primary' : 'btn-secondary'}`} aria-label="Italic numbers" aria-pressed={options.italic} onClick={() => change({ italic: !options.italic })}><Italic size={15} /></button></div>
            <div className="watermark-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={6} max={72} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Colour"><div className="watermark-colour"><input type="color" aria-label="Page number colour" value={options.color} onChange={event => change({ color: event.target.value })} /><span>{options.color.toUpperCase()}</span></div></FormGroup></div>
            <FormGroup label="Edge margin (mm)"><input className="form-input" type="number" min={0} max={50} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup>
            <label className="watermark-check"><input type="checkbox" checked={options.mirror} onChange={event => change({ mirror: event.target.checked })} /> Mirror position on even pages</label>
            <FormGroup label="Numbering sequence"><select className="form-select" value={options.countMode} onChange={event => change({ countMode: event.target.value })}><option value="selected">Consecutive numbers</option><option value="document">Keep gaps for skipped pages</option></select></FormGroup>
          </details>
        </fieldset>
        {plan && <div className="number-label-example"><span>Numbered pages</span><strong>{formatPageNumber(Number(options.startAt) + (options.countMode === 'document' ? plan.selection[0] - Number(options.firstPage) : 0), options.numberStyle)}–{formatPageNumber(Number(options.startAt) + (options.countMode === 'document' ? plan.selection.at(-1) - Number(options.firstPage) : plan.selection.length - 1), options.numberStyle)}</strong><span>{plan.selection.length} of {source.pageCount} PDF pages</span></div>}
        {validationError && <p className="watermark-error" role="alert">{validationError}</p>}
        {failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry numbering</button></p>}
      </aside>
      <section className="watermark-review" aria-label="Page numbers preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'numbered'} onClick={() => setView('numbered')}>Numbered</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span title={pageLabel}>{plan ? pageLabel || 'Not numbered' : 'Check settings'}</span></div><WatermarkPdfPreview blob={displayedBlob} page={page} pageCount={source.pageCount} onPage={setPage} label="Page numbers" updatingLabel="Updating numbers…" updating={view === 'numbered' && !current && !validationError && !failed} error={view === 'numbered' && failed ? failure.message : ''} />{view === 'numbered' && plan && !pageLabel && <div className="watermark-page-note">This page is not numbered.<button className="number-jump" onClick={() => setPage(plan.selection[0])}>Go to first numbered page</button></div>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={saving && generation?.job.params === params ? generation.value : null} label={saving ? generation?.job.params === params ? generation.label : 'Preparing PDF…' : 'Opening PDF…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
