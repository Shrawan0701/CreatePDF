import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Download, FileText, Layers, Link2, LoaderCircle, MessageSquare, RotateCcw, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { createFlattenedPdf, flattenDefaults, flattenPlan, readFlattenSource } from '../services/pdfFlatten'
import './WatermarkWorkspace.css'
import './FlattenPdfWorkspace.css'

export function FlattenPdfWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [options, setOptions] = useState(flattenDefaults)
  const [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0), [generation, setGeneration] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('flattened'), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const input = useRef(null), reading = useRef(null), request = useRef(null), saveJob = useRef(null)
  const locked = loading || saving, params = useMemo(() => ({ source, options }), [source, options])
  const { plan, validationError } = useMemo(() => {
    if (!source) return { plan: null, validationError: '' }
    try { return { plan: flattenPlan(source, options), validationError: '' } }
    catch (failure) { return { plan: null, validationError: failure.message } }
  }, [source, options])
  const current = preview?.params === params, failed = failure?.params === params
  const output = preview && preview.params.source === source ? preview.result.blob : source?.file
  const displayed = view === 'original' ? source?.file : output
  const result = current ? preview.result : null
  const formCount = source?.inventory.filter(item => item.kind === 'form').length || 0, annotationCount = source?.inventory.filter(item => item.kind === 'annotation').length || 0

  const start = job => {
    if (!job.promise) {
      setFailure(previous => previous?.params === job.params ? null : previous)
      job.promise = createFlattenedPdf(job.params.source, job.params.options, {
        signal: job.controller.signal,
        onProgress: (value, label) => { if (!job.controller.signal.aborted) setGeneration({ job, value, label }) },
      }).then(result => {
        if (!job.controller.signal.aborted) { setPreview({ params: job.params, result }); setFailure(null) }
        return result
      }).catch(failure => {
        job.failed = true
        if (!job.controller.signal.aborted) setFailure({ params: job.params, message: failure.message || 'Could not flatten this PDF.' })
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

  const change = update => { setOptions(previous => ({ ...previous, ...update })); setView('flattened'); setError('') }
  const load = async files => {
    if (!files[0] || reading.current || saveJob.current) return
    const controller = new AbortController(); reading.current = controller; setLoading(true); setError('')
    try {
      const loaded = await readFlattenSource(files[0], { signal: controller.signal })
      if (controller.signal.aborted || reading.current !== controller) return
      request.current?.controller.abort(); setSource(loaded); setPage(1); setPreview(null); setFailure(null); setGeneration(null); setView('flattened')
      setOptions(previous => ({ ...previous, pagesMode: 'all', range: '' }))
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
      downloadBlob(output.blob, `flattened-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast(output.forms + output.annotations ? 'Flattened PDF ready.' : 'No matching items to flatten. PDF copy ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this PDF.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; setSaving(false) } }
  }

  return <ToolPage toolId="flatten-pdf"><div className="flatten-workspace">
    <input ref={input} hidden type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel watermark-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><Layers size={32} /><div className="drop-zone-title">Choose a PDF to flatten</div><div className="drop-zone-sub">Form fields and annotations become page content</div></DropZone></div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-primary watermark-download" disabled={locked || !!validationError} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />} Download PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={locked} onClick={close}><X size={17} /></button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings"><div className="watermark-settings-header"><h2>Flatten PDF</h2><button className="icon-btn" disabled={locked} aria-label="Reset flatten settings" title="Reset settings" onClick={() => change(flattenDefaults())}><RotateCcw size={15} /></button></div>
        <div className="flatten-inventory"><div><CheckSquare size={16} /><span>Form controls</span><strong>{formCount}</strong></div><div><MessageSquare size={16} /><span>Annotations</span><strong>{annotationCount}</strong></div><div><Link2 size={16} /><span>Links retained</span><strong>{source.links}</strong></div></div>
        <fieldset disabled={locked}>
          <div className="flatten-options"><label><input type="checkbox" checked={options.forms} onChange={event => change({ forms: event.target.checked })} /><div><strong>Flatten form fields</strong><span>Keep their visible values</span></div></label><label><input type="checkbox" checked={options.annotations} onChange={event => change({ annotations: event.target.checked })} /><div><strong>Flatten annotations</strong><span>Highlights, drawings and stamps</span></div></label></div>
          <FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Page range</option></select></FormGroup>
          {options.pagesMode === 'custom' && <FormGroup label="Pages"><input className="form-input" placeholder="1-3, 5" value={options.range} onChange={event => change({ range: event.target.value })} /></FormGroup>}
          <details className="watermark-advanced"><summary>More settings</summary><FormGroup label="Generated appearance quality"><select className="form-select" value={options.dpi} onChange={event => change({ dpi: Number(event.target.value) })}><option value={150}>Standard · 150 DPI</option><option value={200}>High · 200 DPI</option><option value={300}>Print · 300 DPI</option></select></FormGroup><p className="flatten-small">Used only when an item needs an image appearance.</p></details>
        </fieldset>
        {plan && <div className="flatten-result" role="status"><strong>{!plan.targets.length ? source.inventory.length || source.other ? 'No matching items' : 'Already flat' : failed ? 'Could not flatten this selection' : result ? 'Flattened copy ready' : 'Preparing flattened copy…'}</strong>{plan.targets.length > 0 ? <><span>{plan.forms} form controls · {plan.annotations} annotations</span><span>{plan.affected.length} of {source.pageCount} pages</span></> : <span>No fields or annotations need changing in this selection.</span>}{result?.fallback > 0 && <span>{result.fallback} generated appearances saved as images.</span>}</div>}
        <p className="flatten-small">Original page text and links stay intact. Flattened items are no longer interactive.</p>{source.inventory.some(item => item.type === 'Redact') && <p className="flatten-signature-note">Redaction marks are flattened visually. Use Redact PDF to remove underlying content.</p>}
        {source.other > 0 && <p className="flatten-small">{source.other} other interactive items are kept.</p>}
        {source.signatures > 0 && <p className="flatten-signature-note">This PDF contains digital signatures. Editing the PDF invalidates their certification.</p>}
        {validationError && <p className="watermark-error" role="alert">{validationError}</p>}
        {failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry flattening</button></p>}
      </aside><section className="watermark-review" aria-label="Flattened PDF preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'flattened'} onClick={() => setView('flattened')}>Flattened</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span>{plan?.affected.length ?? 0} pages affected</span></div><WatermarkPdfPreview blob={displayed} page={page} pageCount={source.pageCount} onPage={setPage} label="Flattened PDF" updatingLabel="Flattening PDF…" updating={view === 'flattened' && !current && !validationError && !failed} error={view === 'flattened' && failed ? failure.message : ''} />{view === 'flattened' && plan && plan.targets.length > 0 && !plan.affected.includes(page) && <div className="watermark-page-note">No selected items on this page.<button className="flatten-jump" onClick={() => setPage(plan.affected[0])}>Go to first affected page</button></div>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={saving && generation?.job.params === params ? generation.value : null} label={saving ? generation?.job.params === params ? generation.label : 'Preparing PDF…' : 'Reading PDF…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
