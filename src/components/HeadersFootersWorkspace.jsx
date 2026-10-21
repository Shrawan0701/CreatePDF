import { useEffect, useMemo, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Download, FileText, Italic, LayoutPanelTop, LoaderCircle, Redo2, RotateCcw, Trash2, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { createHeadersFootersPdf, HEADER_FOOTER_FIELDS, headersFootersDefaults, readHeaderFooterSource, validateHeadersFooters } from '../services/pdfHeadersFooters'
import { WATERMARK_FONTS } from '../services/pdfWatermark'
import './WatermarkWorkspace.css'
import './HeadersFootersWorkspace.css'

const initialHistory = () => ({ past: [], options: headersFootersDefaults(), future: [] })
const alignments = [['Left', AlignLeft], ['Center', AlignCenter], ['Right', AlignRight]]
const fieldLabel = field => field.replace(/([A-Z])/g, ' $1').replace(/^./, character => character.toUpperCase())

export function HeadersFootersWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(initialHistory), [activeField, setActiveField] = useState('footerCenter')
  const [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [generation, setGeneration] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('updated'), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const input = useRef(null), fields = useRef({}), reading = useRef(null), request = useRef(null), saveJob = useRef(null)
  const options = history.options, locked = loading || saving
  const hasText = HEADER_FOOTER_FIELDS.some(field => options[field].trim()), usesDate = HEADER_FOOTER_FIELDS.some(field => options[field].includes('{date}'))
  const params = useMemo(() => ({ source, options }), [source, options])
  const { selection, validationError } = useMemo(() => {
    if (!source) return { selection: [], validationError: '' }
    try { return { selection: validateHeadersFooters(options, source.pageCount), validationError: '' } }
    catch (failure) { return { selection: [], validationError: failure.message } }
  }, [source, options])
  const current = preview?.params === params, failed = failure?.params === params
  const output = preview && preview.params.source === source && hasText ? preview.blob : source?.file
  const displayed = view === 'original' ? source?.file : output

  const start = job => {
    if (!job.promise) {
      setFailure(previous => previous?.params === job.params ? null : previous)
      job.promise = createHeadersFootersPdf(job.params.source, job.params.options, {
        signal: job.controller.signal,
        onProgress: (value, label) => { if (!job.controller.signal.aborted) setGeneration({ job, value, label }) },
      }).then(blob => {
        if (!job.controller.signal.aborted) { setPreview({ params: job.params, blob }); setFailure(null) }
        return blob
      }).catch(failure => {
        job.failed = true
        if (!job.controller.signal.aborted) setFailure({ params: job.params, message: failure.message || 'Could not add headers and footers.' })
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

  const change = updates => {
    setError(''); setView('updated')
    setHistory(previous => {
      const next = { ...previous.options, ...updates }
      if (Object.keys(next).every(key => next[key] === previous.options[key])) return previous
      return { past: [...previous.past.slice(-49), previous.options], options: next, future: [] }
    })
  }
  const undo = () => { setError(''); setView('updated'); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), options: previous.past.at(-1), future: [previous.options, ...previous.future] } : previous) }
  const redo = () => { setError(''); setView('updated'); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.options], options: previous.future[0], future: previous.future.slice(1) } : previous) }
  const insert = token => {
    if (locked) return
    const element = fields.current[activeField], text = options[activeField], start = element?.selectionStart ?? text.length, end = element?.selectionEnd ?? start
    const next = text.slice(0, start) + token + text.slice(end)
    if (next.length > 200) { setError('Use up to 200 characters per field.'); return }
    change({ [activeField]: next })
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length) })
  }
  const load = async files => {
    if (!files[0] || reading.current || saveJob.current) return
    const controller = new AbortController(); reading.current = controller; setLoading(true); setError('')
    try {
      const loaded = await readHeaderFooterSource(files[0], { signal: controller.signal })
      if (controller.signal.aborted || reading.current !== controller) return
      request.current?.controller.abort(); setSource(loaded); setPage(1); setPreview(null); setFailure(null); setGeneration(null); setView('updated')
      setHistory(previous => ({ past: [], options: { ...previous.options, pagesMode: 'all', range: '', skipCover: false }, future: [] }))
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
      downloadBlob(blob, `header-footer-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast('PDF with headers and footers ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this PDF.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; setSaving(false) } }
  }

  return <ToolPage toolId="headers-footers"><div className="headers-footers-workspace">
    <input ref={input} hidden type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel watermark-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><LayoutPanelTop size={32} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Add headers and footers with a live preview</div></DropZone></div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-primary watermark-download" disabled={locked || !!validationError} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />} Download PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings">
        <div className="watermark-settings-header"><h2>Headers &amp; footers</h2><button className="icon-btn" disabled={locked || !history.past.length} aria-label="Undo header and footer changes" title="Undo" onClick={undo}><Undo2 size={15} /></button><button className="icon-btn" disabled={locked || !history.future.length} aria-label="Redo header and footer changes" title="Redo" onClick={redo}><Redo2 size={15} /></button><button className="icon-btn" disabled={locked} aria-label="Reset headers and footers" title="Reset settings" onClick={() => change(headersFootersDefaults())}><RotateCcw size={15} /></button></div>
        <fieldset disabled={locked}>
          {['header', 'footer'].map(type => <section className="hf-fields" key={type} aria-label={`${type} text`}><div className="hf-row-heading"><h3>{type === 'header' ? 'Header' : 'Footer'}</h3><button className="icon-btn" title={`Clear ${type}`} aria-label={`Clear ${type}`} onClick={() => change(Object.fromEntries(alignments.map(([align]) => [`${type}${align}`, ''])))}><Trash2 size={13} /></button></div>{alignments.map(([align, Icon]) => {
            const field = `${type}${align}`
            return <label className={`hf-input-row ${activeField === field ? 'is-active' : ''}`} key={field}><Icon size={15} aria-hidden="true" /><input ref={element => { fields.current[field] = element }} className="form-input" aria-label={fieldLabel(field)} placeholder={align} style={{ textAlign: align.toLowerCase() }} maxLength={200} value={options[field]} onFocus={() => setActiveField(field)} onChange={event => change({ [field]: event.target.value })} /></label>
          })}</section>)}
          <div className="hf-inserts"><span>Insert into {fieldLabel(activeField).toLowerCase()}</span><div>{[['{page}', 'Page #'], ['Page {page} of {total}', 'Page # of total'], ['{date}', 'Date'], ['{filename}', 'File name']].map(([token, label]) => <button key={token} title={token} onMouseDown={event => event.preventDefault()} onClick={() => insert(token)}>{label}</button>)}</div></div>
          {usesDate && <div className="watermark-field-pair"><FormGroup label="Date"><input className="form-input" type="date" value={options.date} onChange={event => change({ date: event.target.value })} /></FormGroup><FormGroup label="Date format"><select className="form-select" value={options.dateFormat} onChange={event => change({ dateFormat: event.target.value })}><option value="iso">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></select></FormGroup></div>}
          <div className="watermark-font-row"><FormGroup label="Font"><select className="form-select" value={options.font} onChange={event => change({ font: event.target.value })}>{WATERMARK_FONTS.map(font => <option key={font}>{font}</option>)}</select></FormGroup><button className={`btn btn-sm ${options.bold ? 'btn-primary' : 'btn-secondary'}`} aria-label="Bold text" aria-pressed={options.bold} onClick={() => change({ bold: !options.bold })}><Bold size={15} /></button><button className={`btn btn-sm ${options.italic ? 'btn-primary' : 'btn-secondary'}`} aria-label="Italic text" aria-pressed={options.italic} onClick={() => change({ italic: !options.italic })}><Italic size={15} /></button></div>
          <div className="watermark-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={6} max={36} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Colour"><div className="watermark-colour"><input type="color" aria-label="Header and footer text colour" value={options.color} onChange={event => change({ color: event.target.value })} /><span>{options.color.toUpperCase()}</span></div></FormGroup></div>
          <FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Page range</option></select></FormGroup>
          {options.pagesMode === 'custom' && <FormGroup label="Pages"><input className="form-input" placeholder="1-3, 5" value={options.range} onChange={event => change({ range: event.target.value })} /></FormGroup>}
          <label className="watermark-check"><input type="checkbox" checked={options.skipCover} onChange={event => change({ skipCover: event.target.checked })} /> Skip cover page</label>
          <details className="watermark-advanced"><summary>Margins &amp; layout</summary><div className="watermark-field-pair"><FormGroup label="Side margin (mm)"><input className="form-input" type="number" min={0} max={50} value={options.horizontalMargin} onChange={event => change({ horizontalMargin: event.target.value })} /></FormGroup><FormGroup label="Top / bottom (mm)"><input className="form-input" type="number" min={0} max={50} value={options.verticalMargin} onChange={event => change({ verticalMargin: event.target.value })} /></FormGroup></div><label className="watermark-check"><input type="checkbox" checked={options.autoFit} onChange={event => change({ autoFit: event.target.checked })} /> Fit long text to available space</label><label className="watermark-check"><input type="checkbox" checked={options.headerRule} onChange={event => change({ headerRule: event.target.checked })} /> Line below header</label><label className="watermark-check"><input type="checkbox" checked={options.footerRule} onChange={event => change({ footerRule: event.target.checked })} /> Line above footer</label><label className="watermark-check"><input type="checkbox" checked={options.mirror} onChange={event => change({ mirror: event.target.checked })} /> Swap left / right on even pages</label></details>
        </fieldset>
        {!hasText && <p className="hf-empty-hint">Enter header or footer text to preview.</p>}
        {hasText && validationError && <p className="watermark-error" role="alert">{validationError}</p>}
        {failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry preview</button></p>}
      </aside><section className="watermark-review" aria-label="Headers and footers preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'updated'} onClick={() => setView('updated')}>With headers &amp; footers</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span>{selection.length} of {source.pageCount} pages</span></div><WatermarkPdfPreview blob={displayed} page={page} pageCount={source.pageCount} onPage={setPage} label="Headers and footers" updatingLabel="Updating headers and footers…" updating={view === 'updated' && hasText && !current && !validationError && !failed} error={view === 'updated' && failed ? failure.message : ''} />{view === 'updated' && hasText && !validationError && !selection.includes(page) && <div className="watermark-page-note">This page is excluded.<button className="hf-jump" onClick={() => setPage(selection[0])}>Go to first included page</button></div>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={saving && generation?.job.params === params ? generation.value : null} label={saving ? generation?.job.params === params ? generation.label : 'Preparing PDF…' : 'Opening PDF…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
