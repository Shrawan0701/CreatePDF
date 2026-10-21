import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Download, Eye, FileText, LoaderCircle, PenTool, RotateCcw, ScanText, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { HandwritingPagePreview } from './HandwritingPagePreview'
import { DropZone, FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { buildHandwritingPlan, createHandwritingPdf, HANDWRITING_PAPERS, HANDWRITING_STYLES, handwritingDefaults, handwritingSourcePages, loadHandwritingFonts, readHandwritingSource } from '../services/pdfHandwriting'
import './PdfHandwritingWorkspace.css'

export function PdfHandwritingWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [fonts, setFonts] = useState(null), [fontError, setFontError] = useState(''), [fontRetry, setFontRetry] = useState(0)
  const [options, setOptions] = useState(handwritingDefaults), [edits, setEdits] = useState({}), [range, setRange] = useState('')
  const [tab, setTab] = useState('preview'), [outputPage, setOutputPage] = useState(0), [textPage, setTextPage] = useState(1), [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('')
  const fileInput = useRef(null), operation = useRef(null), cached = useRef(null)
  const params = useMemo(() => ({ options, edits, range }), [options, edits, range]), deferred = useDeferredValue(params)
  const pending = params !== deferred
  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!source) return
    let cancelled = false; setFontError('')
    loadHandwritingFonts().then(loaded => { if (!cancelled) setFonts(loaded) }).catch(failure => { if (!cancelled) setFontError(failure.message) })
    return () => { cancelled = true }
  }, [source?.file, fontRetry])
  const { selection, plan, planError } = useMemo(() => {
    if (!source) return { selection: [], plan: null, planError: '' }
    try {
      const selection = handwritingSourcePages(deferred.range, source.pageCount)
      if (!fonts) return { selection, plan: null, planError: '' }
      try { return { selection, plan: buildHandwritingPlan(source, selection, deferred.edits, deferred.options, fonts), planError: '' } }
      catch (failure) { return { selection, plan: null, planError: failure.message } }
    } catch (failure) { return { selection: [], plan: null, planError: failure.message } }
  }, [source, fonts, deferred])
  const editorPage = selection.includes(textPage) ? textPage : selection[0] || 1
  const currentText = source ? edits[editorPage] ?? source.pages[editorPage - 1].text : ''
  const emptyPages = source ? source.pages.filter(page => selection.includes(page.number) && !(edits[page.number] ?? page.text).trim()).length : 0
  const resultCurrent = result?.plan === plan && !pending
  const invalidate = () => { cached.current = null; setResult(null); setTab(previous => previous === 'pdf' ? 'preview' : previous); setError('') }
  const change = updates => { invalidate(); setOptions(previous => ({ ...previous, ...updates })) }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const load = async incoming => {
    if (operation.current) return
    const file = incoming[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Choose a PDF file.'); return }
    if (Object.keys(edits).length && !window.confirm('Open another PDF and discard your text edits?')) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(0); setStatus('Reading PDF…'); setError('')
    try {
      const loaded = await readHandwritingSource(file, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      invalidate(); setSource(loaded); setEdits({}); setRange(''); setTextPage(1); setOutputPage(0)
      setTab(loaded.pages.some(page => page.text.trim()) ? 'preview' : 'text')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.name === 'PasswordException' ? 'Unlock this password-protected PDF before converting it.' : failure.message || 'Could not read this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const readScans = async () => {
    if (!source || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(0); setStatus('Reading scanned text…'); setError('')
    try {
      const { readDocument } = await import('../services/documentText')
      const pages = await readDocument(source.file, { ocr: true, language: 'auto', signal: controller.signal, onProgress: value => { if (operation.current === controller) setProgress(value) }, onStatus: label => { if (operation.current === controller) setStatus(label) } })
      if (controller.signal.aborted || operation.current !== controller) return
      invalidate(); setSource({ ...source, pages: pages.map(page => ({ number: page.page, text: source.pages[page.page - 1]?.text.trim() ? source.pages[page.page - 1].text : page.text })), ocr: true }); setTab('text')
      showToast('Scanned text is ready to review.', 'success')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not read the scanned text.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const create = async action => {
    if (!plan || pending || busy || operation.current) return
    const filename = `handwriting-${source.file.name.replace(/\.pdf$/i, '')}.pdf`
    if (cached.current?.plan === plan) {
      if (action === 'preview') setTab('pdf')
      else downloadBlob(cached.current.blob, filename)
      return
    }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(0); setStatus('Creating handwriting PDF…'); setError('')
    try {
      const blob = await createHandwritingPdf(plan, { signal: controller.signal, title: source.file.name.replace(/\.pdf$/i, ''), onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      const output = { blob, plan }; cached.current = output; setResult(output)
      if (action === 'preview') setTab('pdf')
      else { downloadBlob(blob, filename); showToast(`${plan.pages.length} handwriting ${plan.pages.length === 1 ? 'page' : 'pages'} ready.`, 'success') }
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not create the handwriting PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const close = () => {
    if (busy || (Object.keys(edits).length && !window.confirm('Close this PDF and discard your text edits?'))) return
    invalidate(); setSource(null); setEdits({}); setRange(''); setOutputPage(0)
  }

  return <ToolPage toolId="pdf-to-handwriting"><div className="pdf-handwriting-workspace">
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel hand-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><PenTool size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Turn its text into handwritten notes</div></DropZone></div> : <>
      <div className="hand-file-bar"><FileText size={19} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{source.pageCount} source pages</span></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={busy} onClick={close}><X size={16} /></button></div>
      <div className="hand-workspace-grid"><aside className="tool-panel hand-settings">
        <fieldset disabled={busy}><legend>Writing style</legend><div className="hand-style-options" role="group" aria-label="Writing style">{Object.entries(HANDWRITING_STYLES).map(([value, settings]) => <button key={value} aria-pressed={options.style === value} style={{ fontFamily: `"${settings.family}", cursive` }} onClick={() => change({ style: value })}><span>Aa</span><small>{settings.label}</small></button>)}</div>
        <div className="hand-ink"><span>Ink</span>{[['#173f78', 'Blue'], ['#252b30', 'Black'], ['#8d253a', 'Red']].map(([color, label]) => <button key={color} aria-label={`${label} ink`} aria-pressed={options.ink === color} style={{ '--ink': color }} onClick={() => change({ ink: color })} />)}<input type="color" aria-label="Custom ink color" value={options.ink} onChange={event => change({ ink: event.target.value })} /></div>
        <div className="hand-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={10} max={30} step={1} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Line spacing"><select className="form-select" value={options.spacing} onChange={event => change({ spacing: Number(event.target.value) })}><option value={1.35}>Compact</option><option value={1.7}>Normal</option><option value={2.1}>Loose</option></select></FormGroup></div>
        <div className="hand-field-pair"><FormGroup label="Paper"><select className="form-select" value={options.paper} onChange={event => change({ paper: event.target.value })}><option value="ivory">Ivory</option><option value="white">White</option><option value="cream">Cream</option></select></FormGroup><FormGroup label="Ruling"><select className="form-select" value={options.rules} onChange={event => change({ rules: event.target.value })}><option value="lined">Ruled</option><option value="grid">Grid</option><option value="plain">Plain</option></select></FormGroup></div>
        <FormGroup label="Source pages"><input className="form-input" autoComplete="off" placeholder="All pages · or 1-3, 5" value={range} onChange={event => { invalidate(); setRange(event.target.value); setOutputPage(0) }} /></FormGroup>
        <details className="hand-advanced"><summary>Page layout</summary><div className="hand-field-pair"><FormGroup label="Page size"><select className="form-select" value={options.size} onChange={event => change({ size: event.target.value })}>{Object.keys(HANDWRITING_PAPERS).map(value => <option key={value}>{value}</option>)}</select></FormGroup><FormGroup label="Orientation"><select className="form-select" value={options.orientation} onChange={event => change({ orientation: event.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup></div><div className="hand-field-pair"><FormGroup label="Margin (mm)"><input className="form-input" type="number" min={10} max={35} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup><FormGroup label="Text flow"><select className="form-select" value={options.flow} onChange={event => change({ flow: event.target.value })}><option value="paragraphs">Reflow paragraphs</option><option value="lines">Keep line breaks</option></select></FormGroup></div><label className="hand-check"><input type="checkbox" checked={options.keepPages} onChange={event => change({ keepPages: event.target.checked })} /> Start each source page on a new sheet</label><label className="hand-check"><input type="checkbox" checked={options.marginLine} disabled={options.rules === 'plain'} onChange={event => change({ marginLine: event.target.checked })} /> Red margin line</label><label className="hand-check"><input type="checkbox" checked={options.pageNumbers} onChange={event => change({ pageNumbers: event.target.checked })} /> Page numbers</label></details>
        </fieldset>
        {plan && <div className="hand-summary"><span><strong>{plan.sourcePages}</strong> source</span><ArrowRight size={15} /><span><strong>{plan.pages.length}</strong> sheets</span></div>}
        {!fonts && !fontError && <p className="hand-status"><LoaderCircle size={14} className="hand-spin" /> Loading writing styles…</p>}
        {fontError && <p className="hand-error" role="alert">{fontError}<button className="btn btn-secondary btn-sm" onClick={() => setFontRetry(value => value + 1)}>Retry</button></p>}
        {planError && <p className="hand-error" role="alert">{planError}</p>}
        {emptyPages > 0 && <div className="hand-scan-note"><span>{emptyPages} {emptyPages === 1 ? 'page has' : 'pages have'} no readable text.</span><button className="btn btn-secondary btn-sm" disabled={busy} onClick={readScans}><ScanText size={14} /> Read scans</button></div>}
        <button className="btn btn-primary hand-download" disabled={!plan || busy || pending} onClick={() => create('download')}>{busy ? <LoaderCircle size={17} className="hand-spin" /> : <Download size={17} />}{busy ? 'Working…' : 'Download PDF'}</button><button className="btn btn-secondary hand-export-preview" disabled={!plan || busy || pending} onClick={() => create('preview')}><Eye size={16} /> Preview PDF</button><button className="hand-reset" disabled={busy} onClick={() => { invalidate(); setOptions(handwritingDefaults()) }}><RotateCcw size={12} /> Reset style</button>
      </aside><section className="hand-review" aria-label="Handwriting workspace">
        <div className="hand-review-tabs" role="group" aria-label="Workspace view">{[['preview', 'Preview'], ['text', 'Edit text'], ['original', 'Original'], ...(resultCurrent ? [['pdf', 'Exported PDF']] : [])].map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
        {tab === 'text' ? <div className="hand-text-panel"><div className="hand-text-toolbar"><label>Source page <select className="form-select" aria-label="Source text page" value={editorPage} disabled={busy} onChange={event => setTextPage(Number(event.target.value))}>{(selection.length ? selection : source.pages.map(page => page.number)).map(number => <option key={number} value={number}>{number}</option>)}</select></label><button className="btn btn-secondary btn-sm" disabled={busy || edits[editorPage] == null} onClick={() => { invalidate(); setEdits(previous => { const next = { ...previous }; delete next[editorPage]; return next }) }}><RotateCcw size={13} /> Restore page text</button></div><textarea className="form-textarea" aria-label={`Text from source page ${editorPage}`} spellCheck value={currentText} disabled={busy} placeholder="Type or paste text here" onChange={event => { invalidate(); setEdits(previous => ({ ...previous, [editorPage]: event.target.value })) }} /><span>{currentText.length.toLocaleString()} characters</span></div> : tab === 'original' ? <DocumentPdfPreview blob={source.file} heading="Original PDF" readyLabel="Source document" initialPage={editorPage} /> : tab === 'pdf' && resultCurrent ? <DocumentPdfPreview blob={result.blob} heading="Handwriting PDF" readyLabel="Matches your download" initialPage={outputPage + 1} /> : <HandwritingPagePreview plan={plan} page={outputPage} onPage={setOutputPage} updating={pending} />}
      </section></div>
    </>}
    {busy && <div className="hand-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
    {error && <p className="hand-error" role="alert">{error}</p>}
  </div></ToolPage>
}
