import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Download, FileText, Grid3x3, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { NupSheetPreview } from './NupSheetPreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob } from './ui'
import { readSplitSource } from '../services/pdfSplit'
import { buildNupPlan, createNupPdf, NUP_COUNTS, NUP_PAPERS, nupDefaults } from '../services/pdfNup'
import { formatFileSize } from '../services/pdfEngine'
import { useApp } from '../context/AppContext'
import './NupWorkspace.css'

function LayoutIcon({ count }) {
  const columns = count === 2 ? 2 : count === 6 ? 3 : Math.sqrt(count)
  return <span className="nup-layout-icon" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${count / columns}, 1fr)` }} aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} />)}</span>
}

export function NupWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null), [options, setOptions] = useState(nupDefaults)
  const [result, setResult] = useState(null), [tab, setTab] = useState('layout'), [sheet, setSheet] = useState(0)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(0), [status, setStatus] = useState('')
  const input = useRef(null), reading = useRef(null), operation = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])
  const { plan, planError } = useMemo(() => {
    if (!source) return { plan: null, planError: '' }
    try { return { plan: buildNupPlan(source, options), planError: '' } }
    catch (failure) { return { plan: null, planError: failure.message } }
  }, [source, options])
  const invalidate = () => { operation.current?.abort(); operation.current = null; setBusy(false); setResult(null); setTab('layout'); setError(''); setProgress(0); setStatus('') }
  const change = updates => { invalidate(); setOptions(previous => ({ ...previous, ...updates })); if ('count' in updates || 'range' in updates || 'order' in updates) setSheet(0) }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); invalidate()
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setLoading(true); setSheet(0); setOptions(previous => ({ ...previous, range: '' }))
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (reading.current === controller && !controller.signal.aborted) setSource(loaded)
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false) } }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; invalidate()
    setFile(null); setSource(null); setLoading(false); setOptions(nupDefaults()); setSheet(0)
  }
  const outputName = () => `${file.name.replace(/\.pdf$/i, '')}-${plan.count}-up.pdf`
  const download = async () => {
    if (!source || !plan || operation.current || loading) return
    if (result?.plan === plan) { downloadBlob(result.blob, outputName()); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing PDF')
    try {
      const created = await createNupPdf(source, plan, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setResult({ ...created, plan }); setTab('pdf')
      downloadBlob(created.blob, outputName()); showToast(`${plan.sheetCount} ${plan.sheetCount === 1 ? 'sheet' : 'sheets'} ready.`, 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setStatus('Cancelled'); setProgress(0) }
  const locked = loading || busy

  return <ToolPage toolId="n-up"><div className="nup-workspace">
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={event => { choose(Array.from(event.target.files)); event.target.value = '' }} />
    {!file ? <div className="tool-panel nup-upload"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']}><Grid3x3 size={29} /><div><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Drop it here or click to browse</div></div></DropZone></div> : <div className="nup-file-bar"><FileText size={18} /><strong title={file.name}>{file.name}</strong><span>{source ? `${source.pageCount} pages` : loading ? 'Opening…' : 'Could not open'}</span><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={busy} onClick={reset} title="Start over" aria-label="Start over"><X size={16} /></button></div>}
    <div className="nup-layout"><aside className="tool-panel nup-settings">
      <h2>Pages per sheet</h2><div className="nup-layout-choices" role="group" aria-label="Pages per sheet">{NUP_COUNTS.map(count => <button key={count} disabled={locked} aria-pressed={options.count === count} onClick={() => change({ count })}><LayoutIcon count={count} /><span>{count}</span></button>)}</div>
      <div className="nup-field-pair"><FormGroup label="Paper size"><select className="form-select" value={options.paper} disabled={locked} onChange={event => change({ paper: event.target.value })}>{Object.keys(NUP_PAPERS).map(paper => <option key={paper}>{paper}</option>)}</select></FormGroup><FormGroup label="Orientation"><select className="form-select" value={options.orientation} disabled={locked} onChange={event => change({ orientation: event.target.value })}><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup></div>
      <FormGroup label="Source pages"><input className="form-input" value={options.range} disabled={locked} autoComplete="off" placeholder="All pages · or 1-3, 5" onChange={event => change({ range: event.target.value })} /></FormGroup>
      {plan?.hasForms && <p className="nup-form-note">Form fields become fixed print content.</p>}
      <details className="nup-advanced"><summary>Spacing &amp; layout</summary><div className="nup-field-pair"><FormGroup label="Margin (mm)"><input className="form-input" type="number" min={0} max={40} step={1} value={options.margin} disabled={locked} onChange={event => change({ margin: event.target.value })} /></FormGroup><FormGroup label="Spacing (mm)"><input className="form-input" type="number" min={0} max={30} step={1} value={options.gap} disabled={locked} onChange={event => change({ gap: event.target.value })} /></FormGroup></div><FormGroup label="Page order"><select className="form-select" value={options.order} disabled={locked} onChange={event => change({ order: event.target.value })}><option value="across">Across, then down</option><option value="down">Down, then across</option></select></FormGroup><label className="nup-check"><input type="checkbox" checked={options.autoRotate} disabled={locked} onChange={event => change({ autoRotate: event.target.checked })} /> Rotate pages for a better fit</label><label className="nup-check"><input type="checkbox" checked={options.borders} disabled={locked} onChange={event => change({ borders: event.target.checked })} /> Page borders</label></details>
      {plan && <div className="nup-summary" aria-live="polite"><span><strong>{plan.pageCount}</strong> pages</span><ArrowRight size={16} /><span><strong>{plan.sheetCount}</strong> {plan.sheetCount === 1 ? 'sheet' : 'sheets'}</span></div>}
      {planError && <p className="nup-error" role="alert">{planError}</p>}{error && <p className="nup-error" role="alert">{error}</p>}
      <button className="btn btn-primary nup-download" disabled={!plan || locked} onClick={download}>{busy ? <LoaderCircle size={17} className="nup-spin" /> : <Download size={17} />}{busy ? 'Creating PDF…' : 'Download PDF'}</button>
      {busy && <div className="nup-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={13} /> Cancel</button></div>}
      <button className="nup-reset" disabled={locked} onClick={() => { invalidate(); setOptions(nupDefaults()); setSheet(0) }}><RotateCcw size={12} /> Reset settings</button>
    </aside><div className="nup-review">
      {loading && <p className="nup-loading" role="status"><LoaderCircle size={17} className="nup-spin" /> Opening PDF…</p>}
      {result && <div className="nup-preview-tabs" aria-label="Preview mode"><button aria-pressed={tab === 'layout'} onClick={() => setTab('layout')}>Sheet layout</button><button aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>Exported PDF · {formatFileSize(result.blob.size)}</button></div>}
      {tab === 'pdf' && result ? <DocumentPdfPreview blob={result.blob} heading="Exported PDF" readyLabel="Matches your download" /> : <NupSheetPreview source={source} plan={plan} sheetIndex={sheet} onSheet={setSheet} />}
      {result?.missingAppearances > 0 && <p className="nup-notice">{result.missingAppearances} form or annotation {result.missingAppearances === 1 ? 'appearance could' : 'appearances could'} not be printed. Check those pages in the exported PDF.</p>}{result?.skippedLinks > 0 && <p className="nup-notice">{result.skippedLinks} {result.skippedLinks === 1 ? 'link could' : 'links could'} not be retained, including targets outside the selected pages.</p>}
    </div></div>
  </div></ToolPage>
}
