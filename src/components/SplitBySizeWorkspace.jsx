import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Download, FileText, FolderArchive, HardDrive, LoaderCircle, RotateCcw, Scissors, ShieldCheck, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { readSplitSource, splitOutputName, summarizeSplitPages } from '../services/pdfSplit'
import { readBookmarkIndex } from '../services/pdfBookmarkSplit'
import { createSizePdfs, formatSizeBytes, sizeLimitBytes } from '../services/pdfSizeSplit'
import '../pages/tools/SplitPdf.css'
import './SplitBySizeWorkspace.css'

const defaults = () => ({ target: '5', unit: 'MB', oversized: 'keep', keepBookmarks: true })
const presets = [[100, 'KB'], [500, 'KB'], [1, 'MB'], [2, 'MB'], [5, 'MB'], [10, 'MB']]
const perPage = 8

export function SplitBySizeWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null)
  const [options, setOptions] = useState(defaults), [filename, setFilename] = useState('')
  const [result, setResult] = useState(null), [tab, setTab] = useState('source'), [selected, setSelected] = useState(0), [listPage, setListPage] = useState(0)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [progress, setProgress] = useState(0)
  const reading = useRef(null), operation = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])
  const { limitBytes, limitError } = useMemo(() => {
    try { return { limitBytes: sizeLimitBytes(options.target, options.unit), limitError: '' } }
    catch (failure) { return { limitBytes: null, limitError: failure.message } }
  }, [options.target, options.unit])
  const lock = busy || loading, outputs = result?.outputs || [], current = outputs[selected]
  const oversizedCount = outputs.filter(output => output.oversized).length
  const largest = outputs.reduce((max, output) => Math.max(max, output.blob.size), 0)
  const pageCount = Math.ceil(outputs.length / perPage)
  const invalidate = () => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setResult(null); setTab('source'); setSelected(0); setListPage(0); setError(''); setStatus(''); setProgress(0)
  }
  const change = updates => { invalidate(); setOptions(previous => ({ ...previous, ...updates })) }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); invalidate()
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setFilename(next.name.replace(/\.pdf$/i, '')); setLoading(true); setStatus('Opening your PDF')
    try {
      const loaded = await readSplitSource(next, controller.signal)
      let bookmarks = [], bookmarkWarning = ''
      try {
        const index = await readBookmarkIndex(loaded, { signal: controller.signal, onProgress: (value, label) => { if (reading.current === controller) { setProgress(value); setStatus(label) } } })
        bookmarks = index.entries
        if (index.unavailableCount) bookmarkWarning = `${index.unavailableCount} bookmark destination${index.unavailableCount === 1 ? '' : 's'} could not be resolved and will be omitted from new parts.`
      } catch (failure) {
        if (controller.signal.aborted) return
        bookmarkWarning = 'The bookmark outline could not be read. Page contents can still be split, but bookmarks cannot be transferred.'
      }
      if (controller.signal.aborted || reading.current !== controller) return
      setSource({ ...loaded, bookmarks, bookmarkWarning }); setStatus('PDF ready'); setProgress(100)
    } catch (failure) { if (!controller.signal.aborted && reading.current === controller) setError(failure.message || 'Could not open this PDF.') }
    finally { if (reading.current === controller) { reading.current = null; setLoading(false) } }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; invalidate()
    setFile(null); setSource(null); setFilename(''); setOptions(defaults()); setLoading(false)
  }
  const create = async () => {
    if (!source || !limitBytes || operation.current || loading) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setResult(null); setTab('source'); setSelected(0); setListPage(0); setError(''); setProgress(0); setStatus('Measuring the actual PDF exports')
    try {
      const created = await createSizePdfs(source, { limitBytes, oversized: options.oversized, keepBookmarks: options.keepBookmarks }, {
        signal: controller.signal,
        onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } },
      })
      if (controller.signal.aborted || operation.current !== controller) return
      setResult(created); setTab('output')
      const count = created.outputs.filter(output => output.oversized).length
      showToast(count ? `${count} single-page part${count === 1 ? ' exceeds' : 's exceed'} the limit. Review the highlighted files.` : created.unchanged ? 'Your original PDF already fits the limit.' : 'Your PDF parts are ready.', count ? 'info' : 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not split this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const outputName = index => result?.unchanged ? source.file.name : splitOutputName(filename, index, outputs[index].pages, outputs.length)
  const save = index => { if (outputs[index]) downloadBlob(outputs[index].blob, outputName(index)) }
  const downloadAll = async () => {
    if (!result || operation.current) return
    if (outputs.length === 1) { save(0); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Packaging measured PDFs')
    try {
      const JSZip = (await import('jszip')).default
      if (controller.signal.aborted) return
      const zip = new JSZip()
      outputs.forEach((output, index) => zip.file(outputName(index), output.blob))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => {
        if (controller.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
        if (operation.current === controller) { setProgress(metadata.percent); setStatus('Preparing ZIP download') }
      })
      if (controller.signal.aborted || operation.current !== controller) return
      const base = splitOutputName(filename, 0, [1], 1).replace(/-01-page-1\.pdf$/, '')
      downloadBlob(blob, `${base}-size-parts.zip`); setStatus('ZIP download ready')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Individual PDFs are still available.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => {
    reading.current?.abort(); reading.current = null; operation.current?.abort(); operation.current = null
    setLoading(false); setBusy(false); setStatus('Cancelled. Choose a file again if it was still opening.'); setProgress(0)
  }
  const inspect = index => { setSelected(index); setTab('output') }
  const alreadyFits = source && limitBytes && source.file.size <= limitBytes

  return <ToolPage toolId="split-by-size"><div className="split-workspace size-split">
    <div className="split-promises"><span><HardDrive size={15} /> Measured output sizes</span><span><FileText size={15} /> Original text and image quality</span><span><ShieldCheck size={15} /> Processed in your browser</span></div>
    <div className="tool-panel split-upload-panel"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`split-upload${file ? ' has-file' : ''}`}><div className="split-upload-icon"><Scissors size={26} /></div><div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF to split by size'}</div><div className="drop-zone-sub">Drop your file here or click to browse</div></div></DropZone>{file && <FileItem file={file} onRemove={reset} meta={source ? `${source.pageCount} pages · ${file.size.toLocaleString()} bytes` : loading ? 'Opening PDF…' : 'Choose again to reload'} />}{loading && <p className="split-loading" role="status"><LoaderCircle size={15} className="split-spin" /> {status}</p>}</div>
    <div className="split-layout"><div className="tool-panel split-settings">
      <div className="split-panel-heading"><span className="split-step">01</span><div><h2>Set your file limit</h2><p>Whole pages, in their original order.</p></div></div>
      <div className="size-limit-fields"><FormGroup label="Maximum size per PDF"><input className="form-input" type="text" inputMode="decimal" autoComplete="off" value={options.target} disabled={lock} aria-invalid={!!limitError} onChange={event => change({ target: event.target.value })} onBlur={() => { if (limitBytes) setOptions(previous => ({ ...previous, target: String(Number(previous.target)) })) }} placeholder="e.g. 5" /></FormGroup><FormGroup label="Unit"><select className="form-select" value={options.unit} disabled={lock} onChange={event => change({ unit: event.target.value })}><option value="KB">KB</option><option value="MB">MB</option></select></FormGroup></div>
      <div className="size-presets" aria-label="Common file limits">{presets.map(([target, unit]) => <button key={`${target}${unit}`} disabled={lock} aria-pressed={limitBytes === target * (unit === 'MB' ? 1000000 : 1000)} onClick={() => change({ target: String(target), unit })}>{target} {unit}</button>)}</div>
      {limitError ? <p className="split-error" role="alert">{limitError}</p> : <p className="split-hint">Maximum: <strong>{limitBytes.toLocaleString()} bytes</strong>. 1 MB = 1,000 KB; 1 KB = 1,000 bytes. This limit applies to each PDF, not the ZIP.</p>}
      <div className="size-option-section"><FormGroup label="If a single page exceeds the limit" hint="Pages are never dropped or flattened into screenshots."><select className="form-select" value={options.oversized} disabled={lock} onChange={event => change({ oversized: event.target.value })}><option value="keep">Keep it separately and flag it</option><option value="stop">Stop — every PDF must fit</option></select></FormGroup>
      <label className="size-check"><input type="checkbox" checked={options.keepBookmarks} disabled={lock} onChange={event => change({ keepBookmarks: event.target.checked })} /> Keep bookmarks for included pages</label><p className="split-hint">External links and standard form fields are retained. Internal links work when their destination is in the same part.</p></div>
      <div className="split-filename-field"><label className="form-label" htmlFor="size-filename">Download filename prefix</label><input id="size-filename" className="form-input" value={filename} maxLength={120} disabled={lock} onChange={event => setFilename(event.target.value)} placeholder="document" /><p className="split-hint">Part numbers and source page ranges are added automatically. An unchanged original keeps its filename.</p></div>
      {error && <p className="split-error" role="alert">{error}</p>}
      <div className="split-main-actions"><button className="btn btn-primary btn-lg" disabled={!source || !limitBytes || lock} onClick={create}><Scissors size={17} />{busy ? 'Working…' : alreadyFits ? 'Prepare original PDF' : result ? 'Recreate PDF parts' : 'Create PDF parts'}<ArrowRight size={17} /></button><button className="btn btn-secondary" disabled={!result || lock} onClick={downloadAll}>{outputs.length === 1 ? <Download size={17} /> : <FolderArchive size={17} />}{outputs.length === 1 ? 'Download PDF' : 'Download all · ZIP'}</button></div>
      {lock && <div className="split-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
      {!lock && status && !result && <p className="split-hint" role="status">{status}</p>}
      <button className="split-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
    </div><div className="split-review">
      <section className="tool-panel split-plan" aria-live="polite"><div className="split-panel-heading"><span className="split-step">02</span><div><h2>{result ? result.unchanged ? 'Your PDF already fits' : oversizedCount ? 'Review oversized pages' : 'Your PDF parts are ready' : 'Review your size split'}</h2><p>{result ? result.unchanged ? 'Original file retained without changing its bytes.' : 'Sizes below match the actual downloadable files.' : 'Create the parts to see exact sizes and page ranges.'}</p></div>{result && <span className="split-plan-count ready">{outputs.length} {outputs.length === 1 ? 'PDF' : 'PDFs'}</span>}</div>
        {result ? <>
          <div className="size-summary"><div><span>Source pages</span><strong>{result.pageCount}</strong></div><div><span>Largest PDF</span><strong title={`${largest.toLocaleString()} bytes`}>{formatSizeBytes(largest)}</strong></div><div className={oversizedCount ? 'has-warning' : ''}><span>Within limit</span><strong>{outputs.length - oversizedCount} / {outputs.length}</strong></div></div>
          <ol className="split-output-list size-output-list" start={listPage * perPage + 1}>{outputs.slice(listPage * perPage, (listPage + 1) * perPage).map((output, offset) => {
            const index = listPage * perPage + offset
            return <li key={index} className={`${output.oversized ? 'size-over-limit' : ''}${tab === 'output' && selected === index ? ' size-selected' : ''}`}><div className="split-output-icon"><FileText size={22} /><span>{String(index + 1).padStart(2, '0')}</span></div><div className="split-output-info"><strong title={outputName(index)}>{outputName(index)}</strong><span>Pages {summarizeSplitPages(output.pages)} · {formatSizeBytes(output.blob.size)}</span><div className="size-usage" aria-hidden="true"><span style={{ width: `${Math.min(100, output.blob.size / result.limitBytes * 100)}%` }} /></div><span className={`size-file-status${output.oversized ? ' exceeds' : ''}`} title={`${output.blob.size.toLocaleString()} / ${result.limitBytes.toLocaleString()} bytes`}>{output.oversized ? `Exceeds limit by ${formatSizeBytes(output.blob.size - result.limitBytes)}` : <><Check size={11} /> Within limit · {output.blob.size.toLocaleString()} bytes</>}</span></div><div className="split-output-actions"><button className="btn btn-secondary btn-sm" aria-pressed={tab === 'output' && selected === index} onClick={() => inspect(index)}>Preview</button><button className="btn btn-secondary btn-icon btn-sm" disabled={busy} aria-label={`Download part ${index + 1}`} onClick={() => save(index)}><Download size={14} /></button></div></li>
          })}</ol>
          {pageCount > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-sm" disabled={listPage === 0} onClick={() => setListPage(previous => previous - 1)}>Previous</button><span>{listPage + 1} / {pageCount}</span><button className="btn btn-secondary btn-sm" disabled={listPage + 1 >= pageCount} onClick={() => setListPage(previous => previous + 1)}>Next</button></div>}
          {oversizedCount > 0 && <p className="split-warning">{oversizedCount} single-page {oversizedCount === 1 ? 'PDF exceeds' : 'PDFs exceed'} the limit. These pages are kept intact and highlighted above. Increase the limit or <Link to="/compress-pdf">compress the source PDF</Link>, then split again.</p>}
          {outputs.some(output => output.skippedLinks > 0) && <p className="split-warning">Some internal links point to pages in other parts and were omitted. Links to websites remain intact.</p>}
          {outputs.some(output => output.signaturesCleared > 0) && <p className="split-warning">Certificate signatures cannot transfer to new PDF parts. Their visible appearance is retained.</p>}
          {!result.unchanged && <p className="split-hint">Every source page is included once. Shared fonts and images may be repeated across parts, so their combined size can exceed the original.</p>}
        </> : <div className="size-before-results">{source ? <><div className="size-source-stats"><span>{source.pageCount} pages</span><strong>{formatSizeBytes(source.file.size)}</strong><span>Original PDF</span></div>{alreadyFits ? <p className="size-fits-note"><Check size={16} /> Your PDF is already below this limit. Prepare it to download the original unchanged.</p> : <p>We will export and measure page groups to fit your limit. The number of parts depends on actual page resources, including shared images and fonts.</p>}</> : <p>Choose a PDF, set a limit in KB or MB, and create your parts. You can preview and download each one here.</p>}</div>}
        {source?.bookmarkWarning && options.keepBookmarks && !alreadyFits && <p className="split-warning">{source.bookmarkWarning}</p>}
      </section>
      {source ? <div className="split-result-preview"><div className="split-preview-tabs" aria-label="PDF preview"><button aria-pressed={tab === 'source'} onClick={() => setTab('source')}>Original PDF</button><button disabled={!result} aria-pressed={tab === 'output'} onClick={() => setTab('output')}>{result ? `Part ${selected + 1} of ${outputs.length}` : 'Output preview'}</button></div>{tab === 'output' && current && <div className="size-preview-controls"><button className="btn btn-secondary btn-sm" disabled={selected === 0} onClick={() => { setSelected(previous => previous - 1); setListPage(Math.floor((selected - 1) / perPage)) }}>Previous part</button><span>{formatSizeBytes(current.blob.size)}</span><button className="btn btn-secondary btn-sm" disabled={selected + 1 >= outputs.length} onClick={() => { setSelected(previous => previous + 1); setListPage(Math.floor((selected + 1) / perPage)) }}>Next part</button></div>}<DocumentPdfPreview blob={tab === 'output' && current ? current.blob : source.file} heading={tab === 'output' ? `Part ${selected + 1} preview` : 'Original PDF preview'} readyLabel={tab === 'output' ? 'Matches the downloaded PDF' : 'Source document'} /></div> : <div className="tool-panel split-empty"><div className="split-empty-illustration"><span><FileText size={27} /></span><ArrowRight size={23} /><span><HardDrive size={25} /></span></div><h3>Smaller files. Whole pages.</h3><p>Split a document for upload limits while retaining original text, images and supported links. Review the actual PDFs before downloading.</p></div>}
    </div></div>
  </div></ToolPage>
}
