import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Eraser, Eye, FileText, LoaderCircle, MousePointer2, Redo2, Square, Trash2, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { RedactionCanvas } from './RedactionCanvas'
import { PdfPageThumbnail } from './PdfPageThumbnail'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { getPdfjsLib, loadPdfBytes } from '../services/pdfEngine'
import { createRedactedPdf, redactionTargetPages } from '../services/pdfRedaction'
import { useApp } from '../context/AppContext'
import './RedactPdfWorkspace.css'

const initialHistory = () => ({ past: [], regions: [], future: [] })
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const dispose = async task => { try { await task?.destroy() } catch { /* A replaced or cancelled loading task may already be closed. */ } }

export function RedactPdfWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(initialHistory), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState('draw'), [color, setColor] = useState('#000000'), [dpi, setDpi] = useState(200), [copyPages, setCopyPages] = useState('all')
  const [tab, setTab] = useState('edit'), [result, setResult] = useState(null), [listMode, setListMode] = useState('page')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('')
  const input = useRef(null), reading = useRef(null), operation = useRef(null), cached = useRef(null)
  const regions = history.regions, locked = loading || busy, selected = regions.find(region => region.id === selectedId)
  const params = useMemo(() => ({ source, regions, dpi }), [source, regions, dpi])
  const pageModels = useMemo(() => source ? Array.from({ length: source.pdf.numPages }, (_, index) => ({ num: index + 1, rotation: 0 })) : [], [source])
  const pageCounts = useMemo(() => { const counts = new Map(); regions.forEach(region => counts.set(region.page, (counts.get(region.page) || 0) + 1)); return counts }, [regions])
  const listed = regions.filter(region => listMode === 'all' || region.page === page), resultCurrent = result?.params === params
  const { targets, copyError } = useMemo(() => {
    if (!source || !selected) return { targets: [], copyError: '' }
    try { return { targets: redactionTargetPages(copyPages, source.pdf.numPages).filter(number => number !== selected.page), copyError: '' } }
    catch (failure) { return { targets: [], copyError: failure.message } }
  }, [source, selected, copyPages])

  useEffect(() => () => { dispose(source?.loadingTask) }, [source])
  useEffect(() => () => { operation.current?.abort(); dispose(reading.current?.task); reading.current = null }, [])
  const invalidate = () => { cached.current = null; setResult(null); setTab('edit'); setError('') }
  const commit = update => {
    if (locked) return
    invalidate()
    setHistory(previous => {
      const next = typeof update === 'function' ? update(previous.regions) : update
      return next === previous.regions ? previous : { past: [...previous.past.slice(-49), previous.regions], regions: next, future: [] }
    })
  }
  const transient = update => { if (!locked) { invalidate(); setHistory(previous => ({ ...previous, regions: update(previous.regions), future: [] })) } }
  const finish = snapshot => { if (!locked) setHistory(previous => previous.regions === snapshot ? previous : { ...previous, past: [...previous.past.slice(-49), snapshot], future: [] }) }
  const undo = () => { if (!locked) { invalidate(); setSelectedId(null); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), regions: previous.past.at(-1), future: [previous.regions, ...previous.future] } : previous) } }
  const redo = () => { if (!locked) { invalidate(); setSelectedId(null); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.regions], regions: previous.future[0], future: previous.future.slice(1) } : previous) } }
  const changePage = number => { if (!locked && source) { setPage(clamp(Number(number) || 1, 1, source.pdf.numPages)); setSelectedId(null) } }
  const chooseRegion = region => { if (!locked) { setPage(region.page); setSelectedId(region.id); setTool('select'); setTab('edit') } }
  const removeSelected = () => { if (selected && !locked) { commit(previous => previous.filter(region => region.id !== selected.id)); setSelectedId(null) } }
  const add = region => { const next = { ...region, id: crypto.randomUUID() }; commit(previous => [...previous, next]); setSelectedId(next.id) }
  const changeColor = value => { setColor(value); if (selected) commit(previous => previous.map(region => region.id === selected.id ? { ...region, color: value } : region)) }
  const nudge = (id, dx, dy) => commit(previous => previous.map(region => region.id === id ? { ...region, x: clamp(region.x + dx, 0, 1 - region.width), y: clamp(region.y + dy, 0, 1 - region.height) } : region))
  const updateCoordinate = (key, raw) => {
    if (!selected) return
    const value = Number(raw) / 100
    if (!Number.isFinite(value)) return
    commit(previous => previous.map(region => {
      if (region.id !== selected.id) return region
      if (key === 'x') return { ...region, x: clamp(value, 0, 1 - region.width) }
      if (key === 'y') return { ...region, y: clamp(value, 0, 1 - region.height) }
      if (key === 'width') return { ...region, width: clamp(value, .001, 1 - region.x) }
      return { ...region, height: clamp(value, .001, 1 - region.y) }
    }))
  }
  const copy = () => {
    if (!selected || !targets.length || locked) return
    const copies = targets.filter(number => !regions.some(region => region.page === number && region.color === selected.color && ['x', 'y', 'width', 'height'].every(key => Math.abs(region[key] - selected[key]) < .000001))).map(page => ({ ...selected, page, id: crypto.randomUUID() }))
    if (copies.length) commit(previous => [...previous, ...copies])
  }
  const load = async incoming => {
    const file = incoming[0]
    if (!file || operation.current || reading.current) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Choose a PDF file.'); return }
    const request = { task: null }; reading.current = request; setLoading(true); setError('')
    try {
      const [pdfjs, bytes] = await Promise.all([getPdfjsLib(), loadPdfBytes(file)])
      if (reading.current !== request) return
      request.task = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
      const pdf = await request.task.promise
      if (reading.current !== request) { await dispose(request.task); return }
      if (!pdf.numPages) throw new Error('This PDF has no pages.')
      cached.current = null; setSource({ file, pdf, loadingTask: request.task }); setHistory(initialHistory()); setSelectedId(null); setPage(1); setTool('draw'); setColor('#000000'); setCopyPages('all'); setTab('edit'); setResult(null)
    } catch (failure) { await dispose(request.task); if (reading.current === request) setError(failure.name === 'PasswordException' ? 'Unlock this PDF before redacting it.' : failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === request) { reading.current = null; setLoading(false) } }
  }
  const close = () => { if (!locked) { cached.current = null; setSource(null); setHistory(initialHistory()); setResult(null); setSelectedId(null); setError('') } }
  const cancel = () => {
    if (reading.current) { const request = reading.current; reading.current = null; dispose(request.task); setLoading(false) }
    operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0)
  }
  const create = async action => {
    if (!source || !regions.length || locked || operation.current) return
    const filename = `redacted-${source.file.name.replace(/\.pdf$/i, '')}.pdf`
    if (cached.current?.params === params) { if (action === 'preview') setTab('pdf'); else downloadBlob(cached.current.blob, filename); return }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setProgress(0); setStatus('Applying permanent redactions…'); setError('')
    try {
      const blob = await createRedactedPdf(source, regions, { dpi, signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      const output = { params, blob }; cached.current = output; setResult(output)
      if (action === 'preview') setTab('pdf')
      else { downloadBlob(blob, filename); showToast('Redacted PDF ready.', 'success') }
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not redact this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  useEffect(() => {
    const keyboard = event => {
      if (!source || locked || tab !== 'edit' || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
      else if (['Delete', 'Backspace'].includes(event.key) && selected) { event.preventDefault(); removeSelected() }
      else if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard)
  })

  return <ToolPage toolId="redact-pdf"><div className="redact-workspace">
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel redact-upload"><DropZone accept={['application/pdf', '.pdf']} onFiles={load}><Eraser size={32} /><div className="drop-zone-title">Choose a PDF to redact</div><div className="drop-zone-sub">Draw over the content you want to remove</div></DropZone></div> : <>
      <div className="redact-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pdf.numPages} pages · {regions.length} areas marked</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={locked} aria-label="Close PDF" title="Close PDF" onClick={close}><X size={17} /></button></div>
      <div className="redact-main-toolbar"><div className="redact-tools" role="group" aria-label="Redaction tools"><button className={`btn btn-sm ${tool === 'draw' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={tool === 'draw'} disabled={locked} onClick={() => { setTool('draw'); setTab('edit') }}><Square size={15} /> Mark area</button><button className={`btn btn-sm ${tool === 'select' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={tool === 'select'} disabled={locked} onClick={() => { setTool('select'); setTab('edit') }}><MousePointer2 size={15} /> Select</button><span className="redact-divider" /><button className="btn btn-secondary btn-icon btn-sm" disabled={locked || !history.past.length} aria-label="Undo redaction edit" title="Undo" onClick={undo}><Undo2 size={15} /></button><button className="btn btn-secondary btn-icon btn-sm" disabled={locked || !history.future.length} aria-label="Redo redaction edit" title="Redo" onClick={redo}><Redo2 size={15} /></button><button className="btn btn-secondary btn-sm" disabled={locked || !selected} onClick={removeSelected}><Trash2 size={14} /> Delete area</button></div><div className="redact-export-actions"><button className="btn btn-secondary" disabled={locked || !regions.length} onClick={() => create('preview')}><Eye size={16} /> Preview PDF</button><button className="btn btn-primary" disabled={locked || !regions.length} onClick={() => create('download')}>{busy ? <LoaderCircle size={16} className="redact-spin" /> : <Download size={16} />} Download redacted PDF</button></div></div>
      <div className="redact-grid"><aside className="redact-pages" aria-label="PDF pages">{pageModels.map(model => <button key={model.num} className={`redact-thumbnail${page === model.num ? ' selected' : ''}`} disabled={locked} aria-label={`Page ${model.num}, ${pageCounts.get(model.num) || 0} redaction areas`} aria-pressed={page === model.num} onClick={() => changePage(model.num)}><PdfPageThumbnail pdf={source.pdf} page={model} /><span>Page {model.num}{pageCounts.has(model.num) && <b>{pageCounts.get(model.num)}</b>}</span></button>)}</aside>
      <section className="redact-review" aria-label="Redaction editor"><div className="redact-review-tabs" role="group" aria-label="Redaction view"><button aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>Mark areas</button>{resultCurrent && <button aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>Redacted PDF</button>}</div>
        {tab === 'pdf' && resultCurrent ? <DocumentPdfPreview blob={result.blob} heading="Redacted PDF" readyLabel="Matches your download" initialPage={page} /> : <RedactionCanvas source={source} page={page} tool={tool} color={color} regions={regions} selectedId={selectedId} onSelect={setSelectedId} onAdd={add} onTransient={transient} onFinish={finish} onNudge={nudge} disabled={locked} />}
        <div className="redact-page-navigation"><button className="btn btn-secondary btn-icon btn-sm" disabled={locked || page === 1} aria-label="Previous page" onClick={() => changePage(page - 1)}><ChevronLeft size={16} /></button><label>Page <select className="form-select" aria-label="Redaction page" value={page} disabled={locked} onChange={event => changePage(event.target.value)}>{pageModels.map(model => <option key={model.num} value={model.num}>{model.num}</option>)}</select> of {source.pdf.numPages}</label><button className="btn btn-secondary btn-icon btn-sm" disabled={locked || page === source.pdf.numPages} aria-label="Next page" onClick={() => changePage(page + 1)}><ChevronRight size={16} /></button></div>
      </section><aside className="tool-panel redact-settings"><fieldset disabled={locked}><legend>Redaction</legend><div className="redact-colors" role="group" aria-label="Redaction colour">{[['#000000', 'Black'], ['#ffffff', 'White']].map(([value, label]) => <button key={value} aria-pressed={(selected?.color || color) === value} onClick={() => changeColor(value)}><span style={{ background: value }} />{label}</button>)}</div>
        <FormGroup label="Export quality"><select className="form-select" value={dpi} onChange={event => { invalidate(); setDpi(Number(event.target.value)) }}><option value={150}>Standard · 150 DPI</option><option value={200}>High · 200 DPI</option><option value={300}>Print · 300 DPI</option></select></FormGroup><p className="redact-output-note">Exported pages become images. Selectable text, links and form fields are removed.</p>
        {selected && <><details className="redact-precise"><summary>Area size & position (%)</summary><div className="redact-field-grid">{[['x', 'Left'], ['y', 'Top'], ['width', 'Width'], ['height', 'Height']].map(([key, label]) => <FormGroup key={key} label={label}><input className="form-input" type="number" min={key === 'x' || key === 'y' ? 0 : .1} max={100} step={.1} value={+(selected[key] * 100).toFixed(1)} onChange={event => updateCoordinate(key, event.target.value)} /></FormGroup>)}</div></details><FormGroup label="Copy selected area to pages"><input className="form-input" placeholder="All · or 1-3, 5" value={copyPages} onChange={event => setCopyPages(event.target.value)} /></FormGroup>{copyError && <p className="redact-error" role="alert">{copyError}</p>}<button className="btn btn-secondary redact-copy" disabled={!targets.length || !!copyError} onClick={copy}><Copy size={13} /> Copy to {targets.length} {targets.length === 1 ? 'page' : 'pages'}</button></>}
      </fieldset><div className="redact-areas-heading"><h2>Marked areas <span>{regions.length}</span></h2><select className="form-select" aria-label="Filter marked areas" value={listMode} onChange={event => setListMode(event.target.value)}><option value="page">This page</option><option value="all">All pages</option></select></div><div className="redact-areas-list">{listed.length ? listed.map(region => <button key={region.id} className={selectedId === region.id ? 'selected' : ''} disabled={locked} onClick={() => chooseRegion(region)}><span className="redact-area-swatch" style={{ background: region.color }} />Area {regions.indexOf(region) + 1}<small>p.{region.page}</small></button>) : <p className="redact-empty">Draw over content to mark an area.</p>}</div><div className="redact-clear-actions"><button className="btn btn-secondary btn-sm" disabled={locked || !pageCounts.has(page)} onClick={() => { commit(previous => previous.filter(region => region.page !== page)); setSelectedId(null) }}>Clear page</button><button className="btn btn-secondary btn-sm" disabled={locked || !regions.length} onClick={() => { commit([]); setSelectedId(null) }}>Clear all</button></div>
      </aside></div>
    </>}
    {locked && <div className="redact-progress"><ProgressBar value={loading ? null : progress} label={loading ? 'Opening PDF…' : status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
    {error && <p className="redact-error" role="alert">{error}</p>}
  </div></ToolPage>
}
