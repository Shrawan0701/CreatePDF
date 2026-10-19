import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ArrowRight, Blend, Check, ChevronLeft, ChevronRight, Download, FileStack, LoaderCircle, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { buildMixPlan, mixDefaults, mixPdfDocuments, readMixSource } from '../services/alternateMix'
import './AlternateMixComposer.css'

const emptySlot = () => ({ file: null, source: null, loading: false, error: '' })
const letters = ['A', 'B']

export function AlternateMixComposer() {
  const { showToast } = useApp()
  const [slots, setSlots] = useState([emptySlot(), emptySlot()])
  const [options, setOptions] = useState(mixDefaults)
  const [result, setResult] = useState(null)
  const [filename, setFilename] = useState('alternate-mix')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Preparing PDFs')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('mixed')
  const [sequencePage, setSequencePage] = useState(0)
  const reads = useRef([null, null])
  const operation = useRef(null)
  useEffect(() => () => { reads.current.forEach(read => read?.abort()); operation.current?.abort(); operation.current = null }, [])

  const sources = slots.map(slot => slot.source)
  const ready = sources.every(Boolean)
  const loading = slots.some(slot => slot.loading)
  const { plan, planError } = useMemo(() => {
    if (!ready) return { plan: null, planError: '' }
    try { return { plan: buildMixPlan(slots.map(slot => slot.source.pageCount), options), planError: '' } }
    catch (error) { return { plan: null, planError: error.message } }
  }, [slots, ready, options])
  const invalidate = () => { setResult(null); setError(''); setSequencePage(0) }
  const change = (key, value) => { setOptions(current => ({ ...current, [key]: value })); invalidate() }
  const changeSource = (index, key, value) => {
    setOptions(current => ({ ...current, sources: current.sources.map((source, item) => item === index ? { ...source, [key]: value } : source) })); invalidate()
  }
  const choose = async (index, file) => {
    reads.current[index]?.abort(); operation.current?.abort(); operation.current = null
    invalidate(); setBusy(false)
    const controller = new AbortController(); reads.current[index] = controller
    setSlots(current => current.map((slot, item) => item === index ? { file: file || null, source: null, loading: !!file, error: '' } : slot))
    setOptions(current => ({ ...current, sources: current.sources.map((source, item) => item === index ? { ...source, pageRange: '' } : source) }))
    if (!file) return
    try {
      const source = await readMixSource(file, controller.signal)
      if (controller.signal.aborted || reads.current[index] !== controller) return
      setSlots(current => current.map((slot, item) => item === index ? { file, source, loading: false, error: '' } : slot))
    } catch (error) {
      if (!controller.signal.aborted && reads.current[index] === controller) setSlots(current => current.map((slot, item) => item === index ? { file, source: null, loading: false, error: error.message } : slot))
    }
  }
  const swap = () => {
    if (busy || loading) return
    setSlots(current => [current[1], current[0]])
    setOptions(current => ({ ...current, sources: [current.sources[1], current.sources[0]] }))
    invalidate()
  }
  const preset = reversed => { setOptions(current => ({ ...current, start: 0, sources: current.sources.map((source, index) => ({ ...source, pagesPerTurn: 1, reverse: index === 1 && reversed })) })); invalidate() }
  const reset = () => {
    reads.current.forEach(read => read?.abort()); operation.current?.abort(); operation.current = null
    setSlots([emptySlot(), emptySlot()]); setOptions(mixDefaults()); setFilename('alternate-mix'); setBusy(false); setProgress(0); setTab('mixed'); invalidate()
  }
  const run = async save => {
    if (!plan || busy || loading) return
    const name = `${filename.trim().replace(/\.pdf$/i, '') || 'alternate-mix'}.pdf`
    if (result && save) { downloadBlob(result.blob, name); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setResult(null); setError(''); setProgress(0); setStatus('Preparing PDFs')
    try {
      const output = await mixPdfDocuments(sources, options, (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label) }
      }, controller.signal)
      if (operation.current !== controller || controller.signal.aborted) return
      setResult(output); setTab('mixed')
      if (save) downloadBlob(output.blob, name)
      showToast(`${output.plan.total} pages mixed. Your PDF is ready to review.`, 'success')
    } catch (error) { if (operation.current === controller && !controller.signal.aborted) setError(error.message || 'Could not mix these PDFs. Try again.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const currentSequencePage = Math.min(sequencePage, Math.max(0, Math.ceil((plan?.total || 0) / 24) - 1))
  const sequence = plan?.pages.slice(currentSequencePage * 24, (currentSequencePage + 1) * 24) || []
  const previewBlob = tab === 'a' ? slots[0].source?.file : tab === 'b' ? slots[1].source?.file : result?.blob

  return <ToolPage toolId="alternate-mix"><div className="mix-composer">
    <div className="mix-proof"><span><ShieldCheck size={15} /> Files stay on your device</span><span><FileStack size={15} /> Original page sizes and content</span><span><Blend size={15} /> Review the exact page order</span></div>
    <div className="mix-upload-heading"><div><h2>Two PDFs. One reading order.</h2><p>Add your documents in the order you want to mix them.</p></div><button className="btn btn-secondary btn-sm" disabled={busy || loading || !slots.some(slot => slot.file)} onClick={swap}><ArrowDownUp size={15} />Swap PDFs</button></div>
    <div className="mix-source-grid">{slots.map((slot, index) => <section key={index} className={`tool-panel mix-source mix-source-${letters[index].toLowerCase()}`} aria-labelledby={`mix-source-${index}-title`} aria-busy={slot.loading}>
      <div className="mix-source-heading"><span className={`mix-badge mix-badge-${index}`}>{letters[index]}</span><div><h3 id={`mix-source-${index}-title`}>{index === 0 ? 'First PDF' : 'Second PDF'}</h3><p>{index === 0 ? 'For example, the front-side scans.' : 'For example, the back-side scans.'}</p></div>{slot.source && <span className="mix-count">{slot.source.pageCount} {slot.source.pageCount === 1 ? 'page' : 'pages'}</span>}</div>
      <DropZone className={`mix-upload mix-upload-${letters[index].toLowerCase()} ${slot.file ? 'has-file' : ''}`} accept={['application/pdf', '.pdf']} onFiles={([file]) => { if (file) choose(index, file) }}><span className="mix-upload-icon"><Upload size={22} /></span><div><div className="drop-zone-title">{slot.file ? `Replace PDF ${letters[index]}` : `Choose PDF ${letters[index]}`}</div><div className="drop-zone-sub">{slot.file ? 'Drop a file or click to replace it' : 'Drop a PDF here or click to browse'}</div></div></DropZone>
      {slot.file && <FileItem file={slot.file} onRemove={() => choose(index, null)} />}
      {slot.loading && <p className="mix-loading" role="status"><LoaderCircle className="mix-spin" size={14} />Reading PDF {letters[index]}…</p>}
      {slot.error && <p className="mix-error" role="alert">{slot.error}</p>}
      {slot.source && <div className="mix-source-options"><div className="mix-source-fields"><FormGroup label={`Pages from PDF ${letters[index]}`} hint="All pages, or enter 1-3, 5."><input className="form-input" disabled={busy} placeholder="All pages" value={options.sources[index].pageRange} onChange={event => changeSource(index, 'pageRange', event.target.value)} /></FormGroup><FormGroup label={`Pages per turn from ${letters[index]}`}><select className="form-select" disabled={busy} value={options.sources[index].pagesPerTurn} onChange={event => changeSource(index, 'pagesPerTurn', Number(event.target.value))}>{[1, 2, 3, 4, 5, 10].map(value => <option key={value} value={value}>{value} {value === 1 ? 'page' : 'pages'}</option>)}</select></FormGroup></div><div className="mix-source-adjust"><label className="check-row"><input type="checkbox" disabled={busy} checked={options.sources[index].reverse} onChange={event => changeSource(index, 'reverse', event.target.checked)} />Reverse PDF {letters[index]} page order</label><select aria-label={`Rotate PDF ${letters[index]} pages`} className="form-select" disabled={busy} value={options.sources[index].rotation} onChange={event => changeSource(index, 'rotation', Number(event.target.value))}><option value="0">No extra rotation</option><option value="90">Rotate 90° clockwise</option><option value="180">Rotate 180°</option><option value="270">Rotate 90° anticlockwise</option></select></div></div>}
    </section>)}</div>

    <div className="mix-workspace"><section className="tool-panel mix-settings" aria-labelledby="mix-settings-title"><div className="mix-panel-heading"><span className="mix-step">01</span><div><h2 id="mix-settings-title">Set the rhythm</h2><p>Choose how the pages come together.</p></div></div>
      <div className="mix-presets" role="group" aria-label="Mixing presets"><button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => preset(false)}>Alternate pages</button><button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => preset(true)}>Scanned fronts & backs</button></div><p className="mix-hint">Front-and-back scans often save the backs in reverse. The scan preset reverses PDF B.</p>
      <FormGroup label="Start with"><select className="form-select" disabled={busy} value={options.start} onChange={event => change('start', Number(event.target.value))}><option value="0">PDF A · First PDF</option><option value="1">PDF B · Second PDF</option></select></FormGroup>
      <FormGroup label="When one PDF runs out"><select className="form-select" disabled={busy} value={options.leftovers} onChange={event => change('leftovers', event.target.value)}><option value="append">Keep all remaining pages</option><option value="blank">Add blanks to complete each turn</option></select></FormGroup><p className="mix-hint">{options.leftovers === 'blank' ? 'Blank pages fill missing positions and match the page size of the other PDF in that turn.' : 'All selected pages are included, even when the documents have different lengths.'}</p>
      <FormGroup label="Output filename"><input className="form-input" autoComplete="off" disabled={busy} value={filename} onChange={event => setFilename(event.target.value)} placeholder="alternate-mix" /></FormGroup>
      {planError && <p className="mix-error" role="alert">{planError}</p>}{error && <p className="mix-error" role="alert">{error}</p>}
      {busy && <div className="mix-progress" role="status"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel mixing</button></div>}
      <div className="mix-actions"><button className="btn btn-primary btn-lg" disabled={!plan || busy || loading} onClick={() => run(false)}>{busy ? <LoaderCircle className="mix-spin" size={18} /> : <Blend size={18} />}{busy ? 'Mixing pages…' : result ? 'Rebuild preview' : 'Mix PDFs'}{!busy && <ArrowRight size={16} />}</button><button className="btn btn-secondary" disabled={!plan || busy || loading} onClick={() => run(true)}><Download size={16} />Download PDF</button><button className="mix-reset" disabled={!slots.some(slot => slot.file) && !result} onClick={reset}><RotateCcw size={13} />Reset workspace</button></div>
      {result && <div className="mix-success" role="status"><Check size={16} /><div><strong>Your mixed PDF is ready</strong><p>{result.plan.total} pages · {formatBytes(result.blob.size)}{result.plan.blankPages ? ` · ${result.plan.blankPages} blanks added` : ''}</p></div></div>}
    </section>

    <div className="mix-review"><section className="tool-panel mix-sequence" aria-labelledby="mix-sequence-title"><div className="mix-panel-heading"><span className="mix-step">02</span><div><h2 id="mix-sequence-title">Your page sequence</h2><p>{plan ? `${plan.total} output pages · ${plan.selections[0].length} from A · ${plan.selections[1].length} from B${plan.blankPages ? ` · ${plan.blankPages} blanks` : ''}` : 'See how the two documents will alternate.'}</p></div>{plan && <span className="mix-count">{plan.total} pages</span>}</div>
      {plan ? <><ol className="mix-sequence-list" start={currentSequencePage * 24 + 1}>{sequence.map((item, index) => <li key={currentSequencePage * 24 + index}><span className="mix-output-index">{currentSequencePage * 24 + index + 1}</span><span className={`mix-page-chip ${item.source === null ? 'is-blank' : `from-${item.source}`}`} title={item.source === null ? `Blank page for PDF ${letters[item.blankFor]}` : `PDF ${letters[item.source]}, original page ${item.pageNumber}${item.rotation ? `, rotate ${item.rotation}°` : ''}`}>{item.source === null ? 'Blank' : `${letters[item.source]}${item.pageNumber}`}</span></li>)}</ol>{plan.total > 24 && <div className="mix-sequence-navigation"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous sequence pages" disabled={currentSequencePage === 0} onClick={() => setSequencePage(currentSequencePage - 1)}><ChevronLeft size={15} /></button><span>{currentSequencePage * 24 + 1}–{Math.min((currentSequencePage + 1) * 24, plan.total)} of {plan.total}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next sequence pages" disabled={(currentSequencePage + 1) * 24 >= plan.total} onClick={() => setSequencePage(currentSequencePage + 1)}><ChevronRight size={15} /></button></div>}<p className="mix-sequence-note">A and B refer to the source PDFs. Numbers refer to their original page numbers.</p></> : <div className="mix-example-order" aria-label="Example page order"><span className="mix-page-chip from-0">A1</span><ArrowRight size={14} /><span className="mix-page-chip from-1">B1</span><ArrowRight size={14} /><span className="mix-page-chip from-0">A2</span><ArrowRight size={14} /><span className="mix-page-chip from-1">B2</span><span className="mix-example-label">Example</span></div>}
    </section>
    <section className="mix-preview" aria-label="Document review"><div className="mix-preview-tabs" role="group" aria-label="Choose a PDF preview"><button aria-pressed={tab === 'mixed'} onClick={() => setTab('mixed')}><Blend size={15} />Mixed PDF</button><button aria-pressed={tab === 'a'} disabled={!slots[0].source} onClick={() => setTab('a')}><span aria-hidden="true" className="mix-tab-letter from-0">A</span>Source A</button><button aria-pressed={tab === 'b'} disabled={!slots[1].source} onClick={() => setTab('b')}><span aria-hidden="true" className="mix-tab-letter from-1">B</span>Source B</button></div>
      {previewBlob ? <DocumentPdfPreview key={tab + (result ? 'ready' : '')} blob={previewBlob} heading={tab === 'mixed' ? 'Mixed PDF preview' : `Source PDF ${tab.toUpperCase()}`} readyLabel={tab === 'mixed' ? 'Matches your download' : 'Original source pages'} /> : <div className="tool-panel mix-preview-empty"><div className="mix-paper-stack" aria-hidden="true"><span>A</span><span>B</span><i><Blend size={20} /></i></div><h3>{busy ? 'Putting your pages in order' : 'A complete preview before you save'}</h3><p>{busy ? 'Copying the selected pages into your mixed PDF.' : plan ? 'Review the sequence, then click Mix PDFs to inspect every page in the finished document.' : 'Add a PDF to each slot to set up your mix. Your finished document will appear here.'}</p></div>}
    </section>{result?.warnings.length > 0 && <div className="mix-warning" role="status">{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    </div></div>
  </div></ToolPage>
}
