import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Bold, Download, FileText, Hash, Italic, LoaderCircle, Plus, Redo2, RotateCcw, Undo2, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { WatermarkPdfPreview } from './WatermarkPdfPreview'
import { useApp } from '../context/AppContext'
import { batesDefaults, batesPageLabel, createBatesPdf, planBatesBatch, readBatesSource } from '../services/pdfBates'
import { NUMBER_POSITIONS } from '../services/pdfPageNumbers'
import { WATERMARK_FONTS } from '../services/pdfWatermark'
import { createPdfArchive, planPdfArchive } from '../services/pdfZip'
import './WatermarkWorkspace.css'
import './PageNumbersWorkspace.css'
import './BatesNumberingWorkspace.css'

const initialHistory = () => ({ past: [], state: { entries: [], options: batesDefaults() }, future: [] })
const positionLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

export function BatesNumberingWorkspace() {
  const { showToast } = useApp()
  const [history, setHistory] = useState(initialHistory), [activeId, setActiveId] = useState(null)
  const [page, setPage] = useState(1), [view, setView] = useState('stamped'), [preview, setPreview] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [progress, setProgress] = useState(null), [error, setError] = useState('')
  const input = useRef(null), reading = useRef(null), request = useRef(null), saveJob = useRef(null), exportContext = useRef(null)
  const cache = useRef(new WeakMap()), jobs = useRef(new Set())
  const { entries, options } = history.state, locked = loading || saving
  const active = entries.find(entry => entry.id === activeId) || entries[0], activePage = active ? Math.min(page, active.source.pageCount) : 1
  const { plan, validationError } = useMemo(() => {
    if (!entries.length) return { plan: null, validationError: '' }
    try { return { plan: planBatesBatch(entries, options), validationError: '' } }
    catch (failure) { return { plan: null, validationError: failure.message } }
  }, [entries, options])
  const activePlan = plan?.files.find(file => file.entry.id === active?.id) || null
  const cached = activePlan ? cache.current.get(activePlan) : null, failed = failure && failure.plan === activePlan
  const displayed = view === 'original' ? active?.source.file : cached || (preview && active && preview.plan.entry.id === active.id ? preview.blob : active?.source.file)
  const label = activePlan ? batesPageLabel(activePlan, activePage, options) : ''

  const commit = update => {
    setError(''); setView('stamped')
    setHistory(previous => ({ past: [...previous.past.slice(-29), previous.state], state: update(previous.state), future: [] }))
  }
  const change = updates => commit(previous => ({ ...previous, options: { ...previous.options, ...updates } }))
  const undo = () => { setError(''); setView('stamped'); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), state: previous.past.at(-1), future: [previous.state, ...previous.future] } : previous) }
  const redo = () => { setError(''); setView('stamped'); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-29), previous.state], state: previous.future[0], future: previous.future.slice(1) } : previous) }
  const select = id => { setActiveId(id); setPage(1); setView('stamped') }
  const move = (id, offset) => commit(previous => {
    const next = [...previous.entries], index = next.findIndex(entry => entry.id === id)
    if (index < 0 || index + offset < 0 || index + offset >= next.length) return previous
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    return { ...previous, entries: next }
  })
  const setRange = range => commit(previous => ({ ...previous, entries: previous.entries.map(entry => entry.id === active.id ? { ...entry, range } : entry) }))

  const start = job => {
    if (!job.promise) {
      jobs.current.add(job)
      setFailure(previous => previous?.plan === job.filePlan ? null : previous)
      job.promise = createBatesPdf(job.filePlan, job.options, {
        signal: job.controller.signal,
        onProgress: (value, message) => {
          const context = exportContext.current
          if (!job.controller.signal.aborted && context?.job === job) setProgress({ value: (context.done + value / 100) / context.count * 90, label: `${context.done + 1}/${context.count}: ${job.filePlan.entry.source.file.name} · ${message}` })
        },
      }).then(blob => {
        if (!job.controller.signal.aborted) { cache.current.set(job.filePlan, blob); setPreview({ plan: job.filePlan, blob }) }
        return blob
      }).catch(failure => {
        job.failed = true
        if (!job.controller.signal.aborted) setFailure({ plan: job.filePlan, message: failure.message || 'Could not apply Bates stamps.' })
        throw failure
      }).finally(() => jobs.current.delete(job))
    }
    return job.promise
  }
  const jobFor = filePlan => {
    const existing = request.current
    if (existing?.filePlan === filePlan && !existing.failed && !existing.controller.signal.aborted) return existing
    return { filePlan, options, controller: new AbortController(), promise: null }
  }
  useEffect(() => {
    if (!activePlan || cache.current.has(activePlan)) return
    const job = jobFor(activePlan); request.current = job
    const timer = setTimeout(() => { start(job).catch(() => {}) }, 400)
    return () => { clearTimeout(timer); job.controller.abort(); if (request.current === job) request.current = null }
  }, [activePlan, options, retry])
  useEffect(() => () => {
    reading.current?.abort(); saveJob.current?.abort(); request.current?.controller.abort()
    for (const job of jobs.current) job.controller.abort()
  }, [])

  const load = async files => {
    if (!files.length || reading.current || saveJob.current) return
    const controller = new AbortController(); reading.current = controller; setLoading(true); setError(''); setProgress({ value: 0, label: 'Opening PDFs…' })
    try {
      const added = []
      for (let index = 0; index < files.length; index++) {
        if (controller.signal.aborted) return
        setProgress({ value: index / files.length * 100, label: `Opening ${index + 1}/${files.length}: ${files[index].name}` })
        let source
        try { source = await readBatesSource(files[index], { signal: controller.signal }) }
        catch (failure) { throw new Error(`${files[index].name}: ${failure.message}`) }
        if (controller.signal.aborted || reading.current !== controller) return
        added.push({ id: crypto.randomUUID(), source, range: '' })
      }
      if (reading.current !== controller || controller.signal.aborted) return
      commit(previous => ({ ...previous, entries: [...previous.entries, ...added] })); select(added[0].id)
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open these PDFs.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false); setProgress(null) } }
  }
  const cancel = () => {
    reading.current?.abort(); reading.current = null; setLoading(false)
    if (saveJob.current) {
      saveJob.current.abort(); saveJob.current = null; exportContext.current = null
      for (const job of jobs.current) job.controller.abort()
      request.current?.controller.abort(); request.current = null; setSaving(false); setRetry(value => value + 1)
    }
    setProgress(null)
  }
  const download = async () => {
    if (!plan || locked || saveJob.current) return
    const controller = new AbortController(); saveJob.current = controller; setSaving(true); setError('')
    const check = () => { if (controller.signal.aborted || saveJob.current !== controller) throw new DOMException('Export cancelled.', 'AbortError') }
    try {
      // Finish the visible preview first so export can share its pending work.
      const work = [activePlan, ...plan.files.filter(file => file !== activePlan)], outputs = new Map()
      for (let index = 0; index < work.length; index++) {
        check()
        const filePlan = work[index], job = jobFor(filePlan)
        exportContext.current = { job, done: index, count: work.length }
        setProgress({ value: index / work.length * 90, label: `Stamping ${index + 1}/${work.length}: ${filePlan.entry.source.file.name}` })
        let blob = cache.current.get(filePlan)
        try { if (!blob) blob = await start(job) }
        catch (failure) { throw new Error(`${filePlan.entry.source.file.name}: ${failure.message}`) }
        check(); outputs.set(filePlan, blob)
      }
      const archiveNames = planPdfArchive(plan.files.map(file => ({ name: `bates-${file.entry.source.file.name}` })))
      let blob, name
      if (plan.files.length === 1) { blob = outputs.get(plan.files[0]); name = archiveNames[0].name }
      else {
        blob = await createPdfArchive(plan.files.map((file, index) => ({ file: outputs.get(file), name: archiveNames[index].name })), {
          signal: controller.signal, onProgress: value => { if (!controller.signal.aborted) setProgress({ value: 90 + value / 10, label: 'Packaging stamped PDFs…' }) },
        }); name = 'bates-numbered-pdfs.zip'
      }
      check(); downloadBlob(blob, name); showToast(plan.files.length === 1 ? 'Bates-stamped PDF ready.' : 'Bates-stamped PDFs ready.', 'success')
    } catch (failure) { if (saveJob.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not export these PDFs.') }
    finally { if (saveJob.current === controller) { saveJob.current = null; exportContext.current = null; setSaving(false); setProgress(null) } }
  }

  return <ToolPage toolId="bates-numbering"><div className="bates-workspace">
    <input ref={input} hidden multiple type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!entries.length ? <div className="tool-panel watermark-upload"><DropZone multiple accept={['application/pdf', '.pdf']} onFiles={load}><Hash size={32} /><div className="drop-zone-title">Choose PDFs to Bates stamp</div><div className="drop-zone-sub">or drop them here</div></DropZone>{(history.past.length > 0 || history.future.length > 0) && <div className="bates-empty-history"><button className="btn btn-secondary btn-sm" disabled={locked || !history.past.length} onClick={undo}><Undo2 size={14} /> Undo</button><button className="btn btn-secondary btn-sm" disabled={locked || !history.future.length} onClick={redo}><Redo2 size={14} /> Redo</button></div>}</div> : <>
      <div className="watermark-filebar"><FileText size={20} /><div><strong>{entries.length === 1 ? active.source.file.name : `${entries.length} PDFs`}</strong><span>{formatBytes(entries.reduce((sum, entry) => sum + entry.source.file.size, 0))} · {plan?.stampCount ?? '—'} pages to stamp</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Plus size={15} /> Add PDFs</button><button className="btn btn-primary watermark-download" disabled={locked || !plan} onClick={download}>{saving ? <LoaderCircle size={16} className="watermark-spin" /> : <Download size={16} />}{entries.length > 1 ? 'Download ZIP' : 'Download PDF'}</button></div>
      <div className="watermark-grid"><aside className="tool-panel watermark-settings">
        <div className="watermark-settings-header"><h2>Bates stamp</h2><button className="icon-btn" disabled={locked || !history.past.length} aria-label="Undo Bates changes" title="Undo" onClick={undo}><Undo2 size={15} /></button><button className="icon-btn" disabled={locked || !history.future.length} aria-label="Redo Bates changes" title="Redo" onClick={redo}><Redo2 size={15} /></button><button className="icon-btn" disabled={locked} aria-label="Reset Bates settings" title="Reset settings" onClick={() => commit(previous => ({ entries: previous.entries.map(entry => ({ ...entry, range: '' })), options: batesDefaults() }))}><RotateCcw size={15} /></button></div>
        <fieldset disabled={locked}>
          <div className="watermark-field-pair"><FormGroup label="Prefix"><input className="form-input" value={options.prefix} maxLength={100} onChange={event => change({ prefix: event.target.value })} /></FormGroup><FormGroup label="Suffix"><input className="form-input" value={options.suffix} maxLength={100} placeholder="Optional" onChange={event => change({ suffix: event.target.value })} /></FormGroup></div>
          <div className="watermark-field-pair"><FormGroup label="Start number"><input className="form-input" inputMode="numeric" value={options.start} maxLength={18} onChange={event => change({ start: event.target.value })} /></FormGroup><FormGroup label="Digit padding"><input className="form-input" type="number" min={1} max={18} step={1} value={options.padding} onChange={event => change({ padding: event.target.value })} /></FormGroup></div>
          {entries.length > 1 && <FormGroup label="Across PDFs"><select className="form-select" value={options.sequence} onChange={event => change({ sequence: event.target.value })}><option value="continuous">Continue numbering</option><option value="restart">Restart for each PDF</option></select></FormGroup>}
          {plan && <div className="bates-sequence"><strong title={plan.firstLabel}>{plan.firstLabel}</strong><span>to</span><strong title={plan.lastLabel}>{plan.lastLabel}</strong></div>}
          <div className="number-position-block"><span>Position</span><div className="number-position-page" role="group" aria-label="Bates stamp position">{NUMBER_POSITIONS.map(position => <button key={position} aria-label={positionLabel(position)} title={positionLabel(position)} aria-pressed={options.position === position} onClick={() => change({ position })}><Hash size={13} /></button>)}<div aria-hidden="true"><i /><i /><i /></div></div><span className="number-position-label">{positionLabel(options.position)}</span></div>
          <div className="bates-files-heading"><span>PDF order</span><span>{entries.length} {entries.length === 1 ? 'file' : 'files'}</span></div>
          <div className="bates-files" aria-label="PDF order">{entries.map((entry, index) => {
            const filePlan = plan?.files[index]
            return <div key={entry.id} className={`bates-file ${active.id === entry.id ? 'is-active' : ''}`}><button className="bates-file-select" aria-pressed={active.id === entry.id} onClick={() => select(entry.id)}><span>{index + 1}</span><div><strong title={entry.source.file.name}>{entry.source.file.name}</strong><small>{entry.source.pageCount} pages{filePlan ? ` · ${filePlan.selection.length} stamps` : ''}</small>{filePlan?.firstLabel && <small className="bates-file-range" title={`${filePlan.firstLabel} → ${filePlan.lastLabel}`}>{filePlan.firstLabel} → {filePlan.lastLabel}</small>}</div></button><div className="bates-file-actions"><button className="icon-btn" disabled={index === 0} title="Move PDF up" aria-label={`Move ${entry.source.file.name} up`} onClick={() => move(entry.id, -1)}><ArrowUp size={13} /></button><button className="icon-btn" disabled={index === entries.length - 1} title="Move PDF down" aria-label={`Move ${entry.source.file.name} down`} onClick={() => move(entry.id, 1)}><ArrowDown size={13} /></button><button className="icon-btn" title="Remove PDF" aria-label={`Remove ${entry.source.file.name}`} onClick={() => commit(previous => ({ ...previous, entries: previous.entries.filter(file => file.id !== entry.id) }))}><X size={13} /></button></div></div>
          })}</div>
          <FormGroup label="Pages in selected PDF" hint="Blank = all pages"><input className="form-input" placeholder="1-3, 5" value={active.range} onChange={event => setRange(event.target.value)} /></FormGroup>
          <details className="watermark-advanced"><summary>Font &amp; page options</summary>
            <div className="watermark-font-row"><FormGroup label="Font"><select className="form-select" value={options.font} onChange={event => change({ font: event.target.value })}>{WATERMARK_FONTS.map(font => <option key={font}>{font}</option>)}</select></FormGroup><button className={`btn btn-sm ${options.bold ? 'btn-primary' : 'btn-secondary'}`} aria-label="Bold Bates stamp" aria-pressed={options.bold} onClick={() => change({ bold: !options.bold })}><Bold size={15} /></button><button className={`btn btn-sm ${options.italic ? 'btn-primary' : 'btn-secondary'}`} aria-label="Italic Bates stamp" aria-pressed={options.italic} onClick={() => change({ italic: !options.italic })}><Italic size={15} /></button></div>
            <div className="watermark-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={6} max={72} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Colour"><div className="watermark-colour"><input type="color" aria-label="Bates stamp colour" value={options.color} onChange={event => change({ color: event.target.value })} /><span>{options.color.toUpperCase()}</span></div></FormGroup></div>
            <div className="watermark-field-pair"><FormGroup label="Edge margin (mm)"><input className="form-input" type="number" min={0} max={50} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup><FormGroup label="Apply to"><select className="form-select" value={options.pagesMode} onChange={event => change({ pagesMode: event.target.value })}><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option></select></FormGroup></div>
            <label className="watermark-check"><input type="checkbox" checked={options.skipCover} onChange={event => change({ skipCover: event.target.checked })} /> Skip each PDF’s cover page</label><label className="watermark-check"><input type="checkbox" checked={options.mirror} onChange={event => change({ mirror: event.target.checked })} /> Mirror position on even pages</label>
          </details>
        </fieldset>
        {validationError && <p className="watermark-error" role="alert">{validationError}</p>}
        {failed && <p className="watermark-error" role="alert">{failure.message}<button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => setRetry(value => value + 1)}>Retry stamp</button></p>}
      </aside><section className="watermark-review" aria-label="Bates stamp preview"><div className="watermark-view-tabs" role="group" aria-label="Document view"><button aria-pressed={view === 'stamped'} onClick={() => setView('stamped')}>Stamped</button><button aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><span title={label}>{plan ? label || 'Not stamped' : 'Check settings'}</span></div><div className="bates-preview-name" title={active.source.file.name}>{active.source.file.name}</div><WatermarkPdfPreview key={active.id} blob={displayed} page={activePage} pageCount={active.source.pageCount} onPage={setPage} label="Bates stamp" updatingLabel="Updating Bates stamp…" updating={view === 'stamped' && !!activePlan && !cached && !failed} error={view === 'stamped' && failed ? failure.message : ''} />{view === 'stamped' && activePlan && !label && <div className="watermark-page-note">This page is not stamped.{activePlan.selection.length > 0 && <button className="number-jump" onClick={() => setPage(activePlan.selection[0])}>Go to first stamped page</button>}</div>}</section></div>
    </>}
    {locked && <div className="watermark-progress"><ProgressBar value={progress?.value ?? null} label={progress?.label || 'Preparing PDFs…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="watermark-error" role="alert">{error}</p>}
  </div></ToolPage>
}
