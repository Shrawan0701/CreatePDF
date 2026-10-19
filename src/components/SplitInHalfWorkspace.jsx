import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Columns2, Download, FileText, FolderArchive, Layers2, LoaderCircle, RotateCcw, Rows2, Scissors, ShieldCheck, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { HalfSplitSourcePreview } from './HalfSplitSourcePreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { formatFileSize } from '../services/pdfEngine'
import { readSplitSource, summarizeSplitPages } from '../services/pdfSplit'
import { readBookmarkIndex } from '../services/pdfBookmarkSplit'
import { buildHalfSplitPlan, createHalfPdfs, halfOutputName, halfSplitDefaults } from '../services/pdfHalfSplit'
import '../pages/tools/SplitPdf.css'
import './SplitInHalfWorkspace.css'

const layouts = [
  { value: 'pages', title: 'Split document', description: 'Divide the page sequence into two PDFs.', icon: Layers2 },
  { value: 'vertical', title: 'Cut left / right', description: 'Split each selected page down the middle.', icon: Columns2 },
  { value: 'horizontal', title: 'Cut top / bottom', description: 'Split each selected page across its height.', icon: Rows2 },
]

export function SplitInHalfWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null)
  const [options, setOptions] = useState(halfSplitDefaults), [filename, setFilename] = useState('')
  const [result, setResult] = useState(null), [tab, setTab] = useState('source'), [sourcePage, setSourcePage] = useState(1)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [progress, setProgress] = useState(0)
  const reading = useRef(null), operation = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])
  const { plan, planError } = useMemo(() => {
    if (!source) return { plan: null, planError: '' }
    try { return { plan: buildHalfSplitPlan(source, options), planError: '' } }
    catch (error) { return { plan: null, planError: error.message } }
  }, [source, options])
  const cutting = options.mode !== 'pages', lock = busy || loading
  const invalidate = () => { operation.current?.abort(); operation.current = null; setBusy(false); setResult(null); setTab('source'); setError(''); setStatus(''); setProgress(0) }
  const change = updates => { invalidate(); setOptions(current => ({ ...current, ...updates })) }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); invalidate()
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setFilename(next.name.replace(/\.pdf$/i, '')); setLoading(true); setSourcePage(1); setStatus('Opening your PDF')
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (controller.signal.aborted || reading.current !== controller) return
      let bookmarks = [], bookmarkWarning = ''
      try {
        const index = await readBookmarkIndex(loaded, { signal: controller.signal, onProgress: (value, label) => { if (reading.current === controller) { setProgress(10 + value * .9); setStatus(label) } } })
        bookmarks = index.entries
      } catch (failure) {
        if (controller.signal.aborted) return
        bookmarkWarning = 'The original bookmark outline could not be read. Page contents can still be split.'
      }
      if (controller.signal.aborted || reading.current !== controller) return
      setSource({ ...loaded, bookmarks, bookmarkWarning })
      setOptions(current => ({ ...current, splitAfter: Math.ceil(loaded.pageCount / 2), pageRange: '' }))
      setProgress(100); setStatus('PDF ready to split')
    } catch (failure) { if (!controller.signal.aborted && reading.current === controller) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === controller) setLoading(false) }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; invalidate()
    setFile(null); setSource(null); setOptions(halfSplitDefaults()); setFilename(''); setSourcePage(1); setLoading(false)
  }
  const create = async () => {
    if (!source || !plan || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setResult(null); setTab('source'); setError(''); setProgress(0); setStatus('Preparing the two halves')
    try {
      const created = await createHalfPdfs(source, options, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setResult(created); setTab(0)
      showToast('Both PDF halves are ready to preview and download.', 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not split this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const save = index => { if (result?.outputs[index]) downloadBlob(result.outputs[index].blob, halfOutputName(filename, result.outputs[index])) }
  const downloadAll = async () => {
    if (!result || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing ZIP download')
    try {
      const JSZip = (await import('jszip')).default
      if (controller.signal.aborted) return
      const zip = new JSZip()
      result.outputs.forEach(output => zip.file(halfOutputName(filename, output), output.blob))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, ({ percent }) => {
        if (controller.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
        if (operation.current === controller) setProgress(percent)
      })
      if (controller.signal.aborted || operation.current !== controller) return
      const base = halfOutputName(filename, { id: 'halves' }).replace(/\.pdf$/i, '')
      downloadBlob(blob, `${base}.zip`); setStatus('ZIP downloaded')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Download the halves individually instead.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => {
    if (loading) { reading.current?.abort(); reading.current = null; setLoading(false) }
    operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0); setStatus('Cancelled. Adjust the settings or choose the PDF again to retry.')
  }
  const inspect = page => { setSourcePage(page); setTab('source') }
  const outputs = result?.outputs || [], currentOutput = tab === 'source' ? null : outputs[tab]
  const previewGeometry = plan?.cuts.get(sourcePage) || (plan?.selectedPages[0] ? plan.cuts.get(plan.selectedPages[0]) : null)
  const previewExamplePage = plan?.cuts.has(sourcePage) ? sourcePage : plan?.selectedPages[0]
  const dimensions = box => {
    if (!previewGeometry) return ''
    const rotated = previewGeometry.rotation === 90 || previewGeometry.rotation === 270
    const mm = value => (value * previewGeometry.unit / 72 * 25.4).toFixed(1)
    return `${mm(rotated ? box.height : box.width)} × ${mm(rotated ? box.width : box.height)} mm`
  }
  const linkWarnings = outputs.reduce((sum, output) => sum + output.skippedLinks + output.outsideLinks, 0)

  return <ToolPage toolId="split-in-half"><div className="split-workspace half-split">
    <div className="split-promises"><span><FileText size={15} /> Original PDF text and images</span><span><Scissors size={15} /> Adjustable, rotation-aware page cuts</span><span><ShieldCheck size={15} /> Processed in your browser</span></div>
    <div className="tool-panel split-upload-panel"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`split-upload${file ? ' has-file' : ''}`}><div className="split-upload-icon"><Scissors size={26} /></div><div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF to divide'}</div><div className="drop-zone-sub">Drop your file here or click to browse</div></div></DropZone>{file && <FileItem file={file} onRemove={reset} meta={source ? `${source.pageCount} pages` : loading ? 'Opening PDF…' : 'Choose again to reload'} />}{loading && <p className="split-loading" role="status"><LoaderCircle size={15} className="split-spin" /> {status}</p>}</div>
    <div className="split-layout"><div className="tool-panel split-settings">
      <div className="split-panel-heading"><span className="split-step">01</span><div><h2>Choose a split layout</h2><p>Split the document or divide the visible page area.</p></div></div>
      <fieldset className="split-mode-list" disabled={lock}><legend className="split-sr-only">Split layout</legend>{layouts.map(({ value, title, description, icon: Icon }) => <label className={`split-mode half-layout-option${options.mode === value ? ' selected' : ''}`} key={value}><input type="radio" name="half-split-layout" value={value} checked={options.mode === value} onChange={() => change({ mode: value })} /><span className="half-layout-icon"><Icon size={20} /></span><span><strong>{title}</strong><span>{description}</span></span><span className="half-option-check" aria-hidden="true">{options.mode === value && <Check size={12} />}</span></label>)}</fieldset>
      <div className="half-settings-section">{!cutting ? <>
        <label className="half-check"><input type="checkbox" checked={options.balanced} disabled={lock} onChange={event => change({ balanced: event.target.checked, splitAfter: plan?.splitAfter || options.splitAfter })} /> Use a balanced page split</label>
        <FormGroup label="Split after page" hint={options.balanced ? 'Calculated automatically. Turn off the balanced split to choose a page.' : 'The first PDF ends on this page; the second starts on the next.'}><input className="form-input" type="number" min={1} max={source ? source.pageCount - 1 : undefined} step={1} value={options.balanced ? plan?.splitAfter ?? options.splitAfter : options.splitAfter} disabled={lock || options.balanced} onChange={event => change({ splitAfter: event.target.value })} /></FormGroup>
        {source?.pageCount % 2 === 1 && options.balanced && <FormGroup label="Odd extra page goes to"><select className="form-select" value={options.oddPage} disabled={lock} onChange={event => change({ oddPage: event.target.value })}><option value="first">First half</option><option value="second">Second half</option></select></FormGroup>}
        {plan && <p className="split-hint">First half: pages 1–{plan.splitAfter}. Second half: pages {plan.splitAfter + 1}–{source.pageCount}.</p>}
      </> : <>
        <div className="half-position-heading"><label className="form-label" htmlFor="half-cut-position">Cut position from the {options.mode === 'vertical' ? 'left' : 'top'}</label><strong>{options.position}%</strong></div><input id="half-cut-position" className="half-position-range" type="range" min={10} max={90} step={1} value={options.position} disabled={lock} onChange={event => change({ position: Number(event.target.value) })} /><div className="half-range-labels"><span>10%</span><button disabled={lock} onClick={() => change({ position: 50 })}>Reset to center</button><span>90%</span></div>
        <div className="half-cut-fields"><FormGroup label="Overlap between halves (mm)" hint="Adds a shared strip around the cut so nearby content appears in both halves."><input className="form-input" type="number" min={0} max={20} step={.5} value={options.overlap} disabled={lock} onChange={event => change({ overlap: event.target.value })} /></FormGroup><FormGroup label="Source pages to cut" hint="Leave blank for all pages. Example: 1-3, 5."><input className="form-input" value={options.pageRange} disabled={lock} onChange={event => change({ pageRange: event.target.value })} placeholder="All pages" /></FormGroup></div>
        <p className="half-crop-note">Page cuts adjust the visible area. Content outside that area remains in the PDF, and file size may stay close to the original.</p>
      </>}</div>
      <div className="half-settings-section"><label className="half-check"><input type="checkbox" checked={options.keepBookmarks} disabled={lock} onChange={event => change({ keepBookmarks: event.target.checked })} /> Keep bookmarks for retained pages</label><p className="split-hint">Text and images stay in PDF format. Visible link areas and form controls are retained; internal links need a destination inside the same output.</p></div>
      <div className="split-filename-field"><label className="form-label" htmlFor="half-filename">Download filename prefix</label><input id="half-filename" className="form-input" value={filename} maxLength={120} disabled={busy} onChange={event => setFilename(event.target.value)} placeholder="document" /><p className="split-hint">Each filename identifies its half.</p></div>
      {planError && <p className="split-error" role="alert">{planError}</p>}{error && <p className="split-error" role="alert">{error}</p>}
      <div className="split-main-actions"><button className="btn btn-primary btn-lg" disabled={!plan || lock} onClick={create}><Scissors size={18} />{busy ? 'Working…' : result ? 'Recreate both halves' : 'Create both halves'}<ArrowRight size={17} /></button><button className="btn btn-secondary" disabled={!result || busy} onClick={downloadAll}><FolderArchive size={17} /> Download both PDFs · ZIP</button></div>
      {(busy || loading) && <div className="split-progress"><ProgressBar value={progress} label={status || 'Preparing the PDF'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}{!busy && !loading && status && !result && <p className="split-hint" role="status">{status}</p>}
      <button className="split-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
    </div><div className="split-review">
      <section className="tool-panel half-output-plan" aria-live="polite"><div className="split-panel-heading"><span className="split-step">02</span><div><h2>{result ? 'Both halves are ready' : 'Your two PDF outputs'}</h2><p>{plan ? cutting ? `${plan.selectedPages.length} source pages · ${plan.selectedPages.length} pages in each half` : `${source.pageCount} source pages · ${plan.outputs[0].pageCount} + ${plan.outputs[1].pageCount} pages` : 'Choose a PDF and a valid split layout to see the plan.'}</p></div></div>
        {plan && <div className="half-output-cards">{plan.outputs.map((output, index) => <div className={`half-output-card side-${index}`} key={output.id}><div className="half-output-card-title"><span className="half-side-number">{index + 1}</span><h3>{output.label}</h3>{result && <Check size={14} />}</div><strong className="half-output-filename" title={halfOutputName(filename, output)}>{halfOutputName(filename, output)}</strong><p>{output.pageCount} {output.pageCount === 1 ? 'page' : 'pages'} · source {summarizeSplitPages(output.pages)}</p>{cutting && previewGeometry && <p className="half-example-size">{dimensions(previewGeometry.boxes[index])} <span>for source page {previewExamplePage}</span></p>}{result && <span className="half-output-bytes">{formatFileSize(outputs[index].blob.size)}</span>}<div className="half-card-actions"><button className="btn btn-secondary btn-sm" onClick={() => result ? setTab(index) : inspect(cutting ? plan.selectedPages[0] : index ? output.pages[0] : output.pages.at(-1))}>{result ? 'Preview PDF' : cutting ? 'Inspect cut' : index ? 'View first page' : 'View last page'}</button>{result && <button className="btn btn-secondary btn-icon btn-sm" aria-label={`Download ${output.label.toLowerCase()}`} disabled={busy} onClick={() => save(index)}><Download size={14} /></button>}</div></div>)}</div>}
        {plan?.omittedPages > 0 && <p className="split-hint">{plan.omittedPages} source {plan.omittedPages === 1 ? 'page is' : 'pages are'} outside the selected range and excluded from both cut PDFs.</p>}{cutting && plan && <p className="split-hint">Dimensions follow each page’s visible area and rotation; mixed page sizes remain different.</p>}
        {source?.bookmarkWarning && options.keepBookmarks && <p className="split-warning">{source.bookmarkWarning}</p>}{linkWarnings > 0 && <p className="split-warning">{linkWarnings} internal {linkWarnings === 1 ? 'link could' : 'links could'} not be included because the destination is outside its output pages or visible half.</p>}{outputs.some(output => output.signaturesCleared > 0) && <p className="split-warning">Certificate signatures cannot be transferred to new PDF halves. Their visible appearance is retained where included.</p>}
      </section>
      {source ? <div className="half-preview-area"><div className="split-preview-tabs" aria-label="Half split preview"><button aria-pressed={tab === 'source'} onClick={() => setTab('source')}>Original / cut line</button>{(plan?.outputs || [{ label: 'First half' }, { label: 'Second half' }]).map((output, index) => <button key={index} disabled={!result} aria-pressed={tab === index} onClick={() => setTab(index)}>{output.label}</button>)}</div>
        {currentOutput ? <div className="half-output-preview"><div className="half-result-actions"><span>{currentOutput.label} · {formatFileSize(currentOutput.blob.size)}</span><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(tab)}><Download size={14} /> Download this half</button></div><DocumentPdfPreview blob={currentOutput.blob} heading={`${currentOutput.label} preview`} readyLabel="Matches this half’s download" /></div> : <HalfSplitSourcePreview source={source} mode={options.mode} position={options.position} overlapRatio={plan?.cuts.get(sourcePage)?.overlapRatio || 0} pageNumber={sourcePage} splitAfter={plan?.splitAfter} included={!cutting || !!plan?.selectedPages.includes(sourcePage)} disabled={lock} onPage={setSourcePage} onPosition={position => change({ position })} />}
      </div> : <div className="tool-panel split-empty"><div className="half-empty-illustration"><span>1</span><Scissors size={24} /><span>2</span></div><h3>Two ways to divide a PDF</h3><p>Split the page sequence into two documents, or cut each page into left/right or top/bottom areas. Review both results before downloading.</p></div>}
    </div></div>
  </div></ToolPage>
}
