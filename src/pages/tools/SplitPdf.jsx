import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Download, FileText, FolderArchive, Link2, LoaderCircle, RotateCcw, Scissors, ShieldCheck, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { SplitPageGrid } from '../../components/SplitPageGrid'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { buildSplitPlan, readSplitSource, splitLoadedPdf, splitOutputName, summarizeSplitPages } from '../../services/pdfSplit'
import { formatFileSize } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'
import './SplitPdf.css'

const initialOptions = () => ({ mode: 'selection', selected: [], separate: false, rangeInput: '', everyN: 2 })
const modes = [['selection', 'Select pages', 'Choose pages visually.'], ['ranges', 'Custom ranges', 'Create a PDF for each range.'], ['every', 'Every few pages', 'Split into equal page groups.'], ['individual', 'One file per page', 'Extract every page separately.']]

export default function SplitPdf() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(initialOptions)
  const [prefix, setPrefix] = useState('')
  const [outputs, setOutputs] = useState(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [groupSheet, setGroupSheet] = useState(0)
  const [tab, setTab] = useState('pages')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const reading = useRef(null), operation = useRef(null), anchor = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])

  const { plan, planError } = useMemo(() => {
    if (!source) return { plan: null, planError: '' }
    try { return { plan: buildSplitPlan(source.pageCount, options), planError: '' } }
    catch (error) { return { plan: null, planError: error.message } }
  }, [source, options])
  const included = useMemo(() => options.mode === 'selection' ? new Set(options.selected) : new Set(plan?.groups.flat() || []), [options.mode, options.selected, plan])
  const invalidate = () => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setOutputs(null); setPreviewIndex(0); setGroupSheet(0); setTab('pages'); setError(''); setStatus(''); setProgress(0)
  }
  const change = updates => { invalidate(); setOptions(current => ({ ...current, ...updates })) }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file to split.'); return }
    reading.current?.abort(); invalidate(); anchor.current = null
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setLoading(true)
    setPrefix(next.name.replace(/\.pdf$/i, ''))
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (controller.signal.aborted || reading.current !== controller) return
      setSource(loaded)
      setOptions(current => ({ ...current, selected: Array.from({ length: loaded.pageCount }, (_, index) => index + 1), rangeInput: loaded.pageCount === 1 ? '1' : `1-${loaded.pageCount}`, everyN: Math.min(Math.max(1, Number(current.everyN) || 2), loaded.pageCount) }))
    } catch (failure) { if (reading.current === controller && !controller.signal.aborted) setError(failure.message) }
    finally { if (reading.current === controller) setLoading(false) }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; anchor.current = null
    invalidate(); setFile(null); setSource(null); setLoading(false); setOptions(initialOptions()); setPrefix('')
  }
  const togglePage = (number, shift) => {
    if (!source || busy || options.mode !== 'selection') return
    const selected = new Set(options.selected), select = !selected.has(number)
    const from = shift && anchor.current ? Math.min(anchor.current, number) : number
    const to = shift && anchor.current ? Math.max(anchor.current, number) : number
    for (let page = from; page <= to; page++) { if (select) selected.add(page); else selected.delete(page) }
    anchor.current = number; change({ selected: [...selected] })
  }
  const selectPages = choice => {
    if (!source || busy) return
    const all = Array.from({ length: source.pageCount }, (_, index) => index + 1), current = new Set(options.selected)
    const selected = choice === 'all' ? all : choice === 'odd' ? all.filter(page => page % 2) : choice === 'even' ? all.filter(page => !(page % 2)) : choice === 'invert' ? all.filter(page => !current.has(page)) : []
    anchor.current = null; change({ selected })
  }
  const create = async () => {
    if (!source || !plan || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setOutputs(null); setTab('pages'); setProgress(0)
    try {
      const results = await splitLoadedPdf(source, plan.groups, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setOutputs(results); setPreviewIndex(0); setGroupSheet(0); setTab('output')
      showToast(`${results.length} PDF${results.length === 1 ? '' : 's'} ready to preview and download.`, 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not split this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const filename = index => splitOutputName(prefix, index, outputs[index].pages, outputs.length)
  const save = index => { if (outputs?.[index]) downloadBlob(outputs[index].blob, filename(index)) }
  const downloadAll = async () => {
    if (!outputs?.length || operation.current) return
    if (outputs.length === 1) { save(0); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing ZIP download')
    try {
      const JSZip = (await import('jszip')).default
      if (controller.signal.aborted) return
      const zip = new JSZip()
      outputs.forEach((output, index) => zip.file(filename(index), output.blob))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, ({ percent }) => {
        if (controller.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
        if (operation.current === controller) setProgress(percent)
      })
      if (controller.signal.aborted || operation.current !== controller) return
      const base = splitOutputName(prefix, 0, [1], 1).replace(/-01-page-1\.pdf$/, '')
      downloadBlob(blob, `${base}-split.zip`); setStatus('ZIP downloaded')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Download the PDFs individually instead.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0); setStatus('Cancelled. You can change your settings and try again.') }
  const groupCount = plan?.fileCount || 0, sheetCount = Math.max(1, Math.ceil(groupCount / 6))
  const sheet = Math.min(groupSheet, sheetCount - 1)
  const visibleGroups = plan?.groups.slice(sheet * 6, sheet * 6 + 6) || []
  const currentOutput = outputs?.[Math.min(previewIndex, outputs.length - 1)]
  const skippedLinks = outputs?.reduce((sum, output) => sum + output.skippedLinks, 0) || 0

  return <ToolPage toolId="split-pdf"><div className="split-workspace">
    <div className="split-promises"><span><FileText size={15} /> Original text and images</span><span><Link2 size={15} /> Links between retained pages</span><span><ShieldCheck size={15} /> Processed in your browser</span></div>
    <div className="tool-panel split-upload-panel"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`split-upload${file ? ' has-file' : ''}`}><div className="split-upload-icon"><FileText size={26} /></div><div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF to split'}</div><div className="drop-zone-sub">{file ? 'Drop a replacement here or click to browse' : 'Drop your file here or click to browse'}</div></div></DropZone>{file && <FileItem file={file} onRemove={reset} meta={source ? `${source.pageCount} pages` : loading ? 'Opening PDF…' : 'Could not open'} />}{loading && <p className="split-loading" role="status"><LoaderCircle size={15} className="split-spin" /> Reading your PDF…</p>}</div>

    <div className="split-layout"><div className="tool-panel split-settings">
      <div className="split-panel-heading"><span className="split-step">01</span><div><h2>Choose how to split</h2><p>Extract what you need, in original page order.</p></div></div>
      <fieldset className="split-mode-list" disabled={busy || loading}><legend className="split-sr-only">Split method</legend>{modes.map(([value, title, description]) => <label key={value} className={`split-mode${options.mode === value ? ' selected' : ''}`}><input type="radio" name="split-method" value={value} checked={options.mode === value} onChange={() => change({ mode: value })} /><span className="split-mode-radio" aria-hidden="true">{options.mode === value && <Check size={11} />}</span><span><strong>{title}</strong><span>{description}</span></span></label>)}</fieldset>
      <div className="split-mode-options">
        {options.mode === 'selection' && <><label className="form-label" htmlFor="split-selection-output">Save selected pages as</label><select id="split-selection-output" className="form-select" disabled={busy || loading} value={options.separate ? 'separate' : 'combined'} onChange={event => change({ separate: event.target.value === 'separate' })}><option value="combined">One PDF with selected pages</option><option value="separate">A separate PDF for each page</option></select><p className="split-hint">Click page thumbnails to select or deselect. Hold Shift to select a range.</p></>}
        {options.mode === 'ranges' && <FormGroup label="Pages for each output PDF" hint="Use a semicolon or a new line for each file. Commas combine pages into the same file."><textarea className="form-textarea" rows={4} value={options.rangeInput} disabled={busy || loading} onChange={event => change({ rangeInput: event.target.value })} placeholder={'1-3; 4-6; 7, 9'} /></FormGroup>}
        {options.mode === 'every' && <FormGroup label="Pages per file" hint="The final file includes any pages left over."><input className="form-input" type="number" min={1} max={source?.pageCount} step={1} value={options.everyN} disabled={busy || loading} onChange={event => change({ everyN: event.target.value })} /></FormGroup>}
        {options.mode === 'individual' && <p className="split-hint">Every page becomes its own PDF. Download them individually or together in a ZIP.</p>}
      </div>
      <div className="split-filename-field"><label className="form-label" htmlFor="split-filename">Filename prefix</label><input id="split-filename" className="form-input" value={prefix} maxLength={120} disabled={busy} onChange={event => setPrefix(event.target.value)} placeholder="document" /><p className="split-hint">File numbers and source page numbers are added automatically.</p></div>
      {planError && <p role="alert" className="split-error">{planError}</p>}{error && <p role="alert" className="split-error">{error}</p>}
      <div className="split-main-actions"><button className="btn btn-primary btn-lg" disabled={!plan || busy || loading} onClick={create}><Scissors size={18} />{busy ? 'Working…' : outputs ? 'Recreate split PDFs' : 'Create split PDFs'}<ArrowRight size={17} /></button><button className="btn btn-secondary" disabled={!outputs || busy} onClick={downloadAll}>{outputs?.length > 1 ? <FolderArchive size={17} /> : <Download size={17} />}{outputs?.length > 1 ? 'Download all PDFs · ZIP' : 'Download PDF'}</button></div>
      {busy && <div className="split-progress"><ProgressBar value={progress} label={status || 'Splitting PDF'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
      {!busy && status && !outputs && <p className="split-hint" role="status">{status}</p>}
      <button className="split-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
    </div><div className="split-review">
      <section className="tool-panel split-plan" aria-live="polite"><div className="split-panel-heading"><span className="split-step">02</span><div><h2>{outputs ? 'Your split PDFs are ready' : 'Your output plan'}</h2><p>{plan ? `${plan.fileCount} PDF${plan.fileCount === 1 ? '' : 's'} · ${plan.uniquePages} of ${source.pageCount} source pages included${outputs ? ` · ${formatFileSize(outputs.reduce((sum, output) => sum + output.blob.size, 0))} total` : ''}` : source ? 'Choose valid pages to see the output plan.' : 'Add a PDF to see the files you will create.'}</p></div>{plan && <span className={`split-plan-count${outputs ? ' ready' : ''}`}>{outputs && <Check size={12} />}{plan.fileCount} {plan.fileCount === 1 ? 'file' : 'files'}</span>}</div>
        {visibleGroups.length > 0 && <ol className="split-output-list" start={sheet * 6 + 1}>{visibleGroups.map((pages, offset) => {
          const index = sheet * 6 + offset
          return <li key={index}><div className="split-output-icon"><FileText size={18} /><span>{String(index + 1).padStart(2, '0')}</span></div><div className="split-output-info"><strong title={splitOutputName(prefix, index, pages, plan.fileCount)}>{splitOutputName(prefix, index, pages, plan.fileCount)}</strong><span>{pages.length} {pages.length === 1 ? 'page' : 'pages'} · source {summarizeSplitPages(pages)}{outputs ? ` · ${formatFileSize(outputs[index].blob.size)}` : ''}</span></div>{outputs && <div className="split-output-actions"><button className="btn btn-secondary btn-sm" onClick={() => { setPreviewIndex(index); setTab('output') }}>Preview</button><button className="btn btn-secondary btn-icon btn-sm" aria-label={`Download file ${index + 1}`} disabled={busy} onClick={() => save(index)}><Download size={14} /></button></div>}</li>
        })}</ol>}
        {sheetCount > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous output files" disabled={sheet === 0} onClick={() => setGroupSheet(sheet - 1)}><ChevronLeft size={15} /></button><span>Files {sheet * 6 + 1}–{Math.min((sheet + 1) * 6, groupCount)} of {groupCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next output files" disabled={sheet + 1 === sheetCount} onClick={() => setGroupSheet(sheet + 1)}><ChevronRight size={15} /></button></div>}
        {plan?.omittedPages > 0 && <p className="split-hint">{plan.omittedPages} source {plan.omittedPages === 1 ? 'page is' : 'pages are'} excluded from these outputs.</p>}{plan?.repeatedPages > 0 && <p className="split-hint">Your ranges overlap: some source pages appear in more than one file.</p>}
        {skippedLinks > 0 && <p className="split-warning">{skippedLinks} internal {skippedLinks === 1 ? 'link could' : 'links could'} not be included. Internal links can only reach pages retained in the same output file.</p>}
        {outputs?.some(output => output.signaturesCleared > 0) && <p className="split-warning">Certificate signatures cannot be transferred to a new split PDF. Their visual appearance is retained, but the new files have no valid certificate signature.</p>}
      </section>
      {source ? <div className="split-review-content"><div className="split-preview-tabs" aria-label="Split workspace view"><button aria-pressed={tab === 'pages'} onClick={() => setTab('pages')}>Source pages</button><button aria-pressed={tab === 'output'} disabled={!outputs} onClick={() => setTab('output')}>Output preview</button></div>
        {tab === 'pages' || !outputs ? <div className="tool-panel split-pages-panel"><SplitPageGrid source={source} selected={included} onToggle={togglePage} onSelect={selectPages} selectable={options.mode === 'selection'} disabled={busy} /></div> : <div className="split-result-preview"><div className="split-result-toolbar"><div><strong>File {previewIndex + 1} of {outputs.length}</strong><span>{summarizeSplitPages(currentOutput.pages)} · {formatFileSize(currentOutput.blob.size)}</span></div><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous split PDF" disabled={previewIndex === 0} onClick={() => setPreviewIndex(previewIndex - 1)}><ChevronLeft size={15} /></button><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next split PDF" disabled={previewIndex + 1 === outputs.length} onClick={() => setPreviewIndex(previewIndex + 1)}><ChevronRight size={15} /></button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(previewIndex)}><Download size={14} /> Download</button></div></div><DocumentPdfPreview blob={currentOutput.blob} heading="Output PDF preview" readyLabel="Matches this file’s download" /></div>}
      </div> : <div className="tool-panel split-empty"><div className="split-empty-illustration"><span>1</span><Scissors size={23} /><span>2</span></div><h3>Your pages, your choice</h3><p>Choose pages visually, split by ranges, or create a separate file for every page. Review the PDFs before downloading.</p></div>}
    </div></div>
  </div></ToolPage>
}
