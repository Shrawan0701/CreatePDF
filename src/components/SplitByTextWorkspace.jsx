import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, FolderArchive, Link2, LoaderCircle, RotateCcw, Scissors, Search, ShieldCheck, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DropZone, FileItem, FormGroup, Modal, ProgressBar, downloadBlob } from './ui'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { useApp } from '../context/AppContext'
import { formatFileSize } from '../services/pdfEngine'
import { readSplitSource, splitLoadedPdf, splitOutputName, summarizeSplitPages } from '../services/pdfSplit'
import { buildTextSplitPlan, compileTextSplitSearch, findTextSplitMatches, indexTextSplitSource, textSplitDefaults } from '../services/pdfTextSplit'
import '../pages/tools/SplitPdf.css'
import './SplitByTextWorkspace.css'

export function SplitByTextWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [options, setOptions] = useState(textSplitDefaults)
  const [scan, setScan] = useState(null), [enabled, setEnabled] = useState([])
  const [prefix, setPrefix] = useState(''), [outputs, setOutputs] = useState(null)
  const [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('')
  const [tab, setTab] = useState('matches'), [matchSheet, setMatchSheet] = useState(0), [fileSheet, setFileSheet] = useState(0)
  const [previewIndex, setPreviewIndex] = useState(0), [sourcePage, setSourcePage] = useState(null)
  const reading = useRef(null), operation = useRef(null), indexCache = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])

  const validation = useMemo(() => {
    if (!options.markers.trim()) return ''
    try { compileTextSplitSearch(options); return '' } catch (error) { return error.message }
  }, [options])
  const plan = useMemo(() => source && scan ? buildTextSplitPlan(source.pageCount, enabled, options) : null, [source, scan, enabled, options])
  const selected = useMemo(() => new Set(enabled), [enabled])
  const boundaryPages = useMemo(() => new Set(plan?.boundaries.map(item => item.page) || []), [plan])
  const boundaryLabel = page => {
    if (!selected.has(page)) return 'Not used'
    if (boundaryPages.has(page)) return options.boundary === 'before' ? 'New file starts here' : `New file starts on page ${page + 1}`
    if (options.boundary === 'before' && page === 1) return 'Document start'
    if (options.boundary === 'after' && page === source.pageCount) return 'Document end'
    return 'Grouped with adjacent matches'
  }
  const stop = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0); setStatus('') }
  const clearOutputs = () => { setOutputs(null); setPreviewIndex(0); setFileSheet(0); setError(''); setTab('matches') }
  const clearScan = () => { stop(); clearOutputs(); setScan(null); setEnabled([]); setMatchSheet(0) }
  const changeSearch = updates => { clearScan(); setOptions(current => ({ ...current, ...updates })) }
  const changePlan = updates => { stop(); clearOutputs(); setOptions(current => ({ ...current, ...updates })) }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); clearScan(); indexCache.current = null; setSourcePage(null)
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setLoading(true); setPrefix(next.name.replace(/\.pdf$/i, ''))
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (!controller.signal.aborted && reading.current === controller) setSource(loaded)
    } catch (error) { if (!controller.signal.aborted && reading.current === controller) setError(error.message) }
    finally { if (reading.current === controller) setLoading(false) }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; indexCache.current = null
    clearScan(); setFile(null); setSource(null); setLoading(false); setOptions(textSplitDefaults()); setPrefix(''); setSourcePage(null)
  }
  const search = async () => {
    if (!source || operation.current || validation || !options.markers.trim()) return
    const controller = new AbortController(); operation.current = controller
    clearOutputs(); setScan(null); setEnabled([]); setBusy(true); setProgress(0); setStatus('Reading searchable PDF text')
    try {
      let index = indexCache.current?.source === source ? indexCache.current.index : null
      if (!index) {
        index = await indexTextSplitSource(source, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value * .8); setStatus(label) } } })
        if (controller.signal.aborted || operation.current !== controller) return
        indexCache.current = { source, index }
      }
      const found = await findTextSplitMatches(index, options, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(80 + value * .2); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setScan(found); setEnabled(found.matches.map(match => match.page)); setMatchSheet(0)
      showToast(found.matches.length ? `${found.matches.length} matching ${found.matches.length === 1 ? 'page' : 'pages'} found. Review your split points.` : 'No matching pages found. Adjust your markers or search options.', found.matches.length ? 'success' : 'info')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not search this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const selectMatches = pages => { stop(); clearOutputs(); setEnabled(pages) }
  const toggleMatch = page => selectMatches(selected.has(page) ? enabled.filter(number => number !== page) : [...enabled, page])
  const create = async () => {
    if (!source || !plan?.hasSplit || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setOutputs(null); setProgress(0); setStatus('Creating split PDFs')
    try {
      const results = await splitLoadedPdf(source, plan.groups, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setOutputs(results); setPreviewIndex(0); setFileSheet(0); setTab('files')
      showToast(`${results.length} PDFs ready. Every source page is included.`, 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the split PDFs.') }
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
      downloadBlob(blob, `${base}-text-sections.zip`); setStatus('ZIP downloaded')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Download files individually instead.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { stop(); setStatus('Cancelled. You can adjust the settings and try again.') }
  const matchSheets = Math.max(1, Math.ceil((scan?.matches.length || 0) / 8)), currentMatchSheet = Math.min(matchSheet, matchSheets - 1)
  const matchRows = scan?.matches.slice(currentMatchSheet * 8, currentMatchSheet * 8 + 8) || []
  const fileCount = plan?.hasSplit ? plan.fileCount : 0, fileSheets = Math.max(1, Math.ceil(fileCount / 6)), currentFileSheet = Math.min(fileSheet, fileSheets - 1)
  const fileRows = plan?.hasSplit ? plan.groups.slice(currentFileSheet * 6, currentFileSheet * 6 + 6) : []
  const currentOutput = outputs?.[previewIndex]
  const skippedLinks = outputs?.reduce((sum, output) => sum + output.skippedLinks, 0) || 0
  const lock = busy || loading

  return <ToolPage toolId="split-by-text"><div className="split-workspace text-split">
    <div className="split-promises"><span><Search size={15} /> Review matching text before splitting</span><span><Link2 size={15} /> Original text, images, and supported links</span><span><ShieldCheck size={15} /> Processed in your browser</span></div>
    <div className="tool-panel split-upload-panel"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`split-upload${file ? ' has-file' : ''}`}><div className="split-upload-icon"><FileText size={26} /></div><div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF to split by text'}</div><div className="drop-zone-sub">Drop your file here or click to browse</div></div></DropZone>{file && <FileItem file={file} onRemove={reset} meta={source ? `${source.pageCount} pages` : loading ? 'Opening PDF…' : 'Could not open'} />}{loading && <p className="split-loading" role="status"><LoaderCircle size={15} className="split-spin" /> Opening your PDF…</p>}</div>
    <div className="split-layout"><div className="tool-panel split-settings">
      <div className="split-panel-heading"><span className="split-step">01</span><div><h2>Find your section markers</h2><p>Look for invoice numbers, headings, or other recurring text.</p></div></div>
      <FormGroup label="Section marker text" hint="One marker per line. Punctuation is matched as ordinary text."><textarea className="form-textarea text-split-markers" rows={3} value={options.markers} maxLength={12000} disabled={lock} onChange={event => changeSearch({ markers: event.target.value })} placeholder={'Invoice Number\nChapter'} /></FormGroup>
      <FormGroup label="Text matching"><select className="form-select" value={options.matchMode} disabled={lock} onChange={event => changeSearch({ matchMode: event.target.value })}><option value="contains">Page contains the text</option><option value="words">Match whole words or phrase</option><option value="line">Match a complete line</option></select></FormGroup>
      <FormGroup label="When using several markers"><select className="form-select" value={options.markerLogic} disabled={lock} onChange={event => changeSearch({ markerLogic: event.target.value })}><option value="any">Match any marker</option><option value="all">Match every marker on the page</option></select></FormGroup>
      <label className="text-split-check"><input type="checkbox" checked={options.caseSensitive} disabled={lock} onChange={event => changeSearch({ caseSensitive: event.target.checked })} /> Match letter case</label>
      <div className="text-split-region"><FormGroup label="Where to search"><select className="form-select" value={options.region} disabled={lock} onChange={event => changeSearch({ region: event.target.value })}><option value="anywhere">Anywhere on the page</option><option value="header">Top of the page</option><option value="footer">Bottom of the page</option></select></FormGroup>{options.region !== 'anywhere' && <FormGroup label="Page height"><select className="form-select" value={options.regionSize} disabled={lock} onChange={event => changeSearch({ regionSize: Number(event.target.value) })}>{[10, 15, 20, 25, 30, 40, 50].map(size => <option key={size} value={size}>{size}%</option>)}</select></FormGroup>}</div>
      <p className="split-hint">Searches selectable text, including page 1. Header and footer filtering helps avoid matches in body text.</p>
      {validation && <p className="split-error" role="alert">{validation}</p>}
      <button className="btn btn-secondary text-split-search" disabled={!source || lock || !options.markers.trim() || !!validation} onClick={search}><Search size={16} />{scan ? 'Search again' : 'Find matching pages'}</button>

      <div className="text-split-rule"><h3>Turn matches into sections</h3><FormGroup label="Split position"><select className="form-select" value={options.boundary} disabled={lock} onChange={event => changePlan({ boundary: event.target.value })}><option value="before">Start a new file on the matching page</option><option value="after">Start a new file after the matching page</option></select></FormGroup><label className="text-split-check"><input type="checkbox" checked={options.collapseConsecutive} disabled={lock} onChange={event => changePlan({ collapseConsecutive: event.target.checked })} /> Group consecutive matching pages</label><p className="split-hint">{options.collapseConsecutive ? options.boundary === 'before' ? 'A consecutive run uses its first matching page as the section start.' : 'A consecutive run ends a section after its last matching page.' : 'Each checked matching page can create a split point.'} All source pages are retained.</p></div>
      <div className="split-filename-field"><label className="form-label" htmlFor="text-split-prefix">Filename prefix</label><input id="text-split-prefix" className="form-input" value={prefix} maxLength={120} disabled={busy} onChange={event => setPrefix(event.target.value)} placeholder="document" /><p className="split-hint">File numbers and source page ranges are added automatically.</p></div>
      {error && <p className="split-error" role="alert">{error}</p>}
      <div className="split-main-actions"><button className="btn btn-primary btn-lg" disabled={!plan?.hasSplit || lock} onClick={create}><Scissors size={18} />{busy ? 'Working…' : outputs ? 'Recreate split PDFs' : 'Create split PDFs'}<ArrowRight size={17} /></button><button className="btn btn-secondary" disabled={!outputs || busy} onClick={downloadAll}><FolderArchive size={17} /> Download all PDFs · ZIP</button></div>
      {busy && <div className="split-progress"><ProgressBar value={progress} label={status || 'Processing PDF'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}{!busy && status && !outputs && <p className="split-hint" role="status">{status}</p>}
      <button className="split-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
    </div><div className="split-review">
      <section className="tool-panel text-split-overview" aria-live="polite"><div className="split-panel-heading"><span className="split-step">02</span><div><h2>{outputs ? 'Your section PDFs are ready' : scan ? 'Review your split points' : 'Find, review, then split'}</h2><p>{outputs ? 'Preview any file or download the complete set.' : scan ? 'Uncheck unwanted matches before creating files.' : 'Matching pages and excerpts will appear here.'}</p></div></div><div className="text-split-stats"><div><strong>{scan ? scan.matches.length : '—'}</strong><span>matching pages</span></div><div><strong>{scan ? fileCount : '—'}</strong><span>planned PDFs</span></div><div><strong>{source?.pageCount || '—'}</strong><span>source pages retained</span></div></div>
        {scan && !plan?.hasSplit && <p className="text-split-no-boundary">{!scan.matches.length ? 'No matching pages found. Try different marker text, a wider search region, or turn off case matching.' : !enabled.length ? 'Select at least one match that creates a new section.' : 'These matches do not create a new section. A marker at the document edge cannot create an empty PDF. Adjust the split position or choose other matches.'}</p>}
        {plan?.hasSplit && <p className="split-hint">{plan.boundaries.length} split {plan.boundaries.length === 1 ? 'point' : 'points'} · {enabled.length} checked {enabled.length === 1 ? 'match' : 'matches'}{plan.collapsedCount ? ` · ${plan.collapsedCount} consecutive matches grouped` : ''}. Pages before the first split point remain in the first file.</p>}
      </section>
      {scan && <div className="split-preview-tabs" aria-label="Text split review"><button aria-pressed={tab === 'matches'} onClick={() => setTab('matches')}>Matching pages{scan.matches.length ? ` · ${scan.matches.length}` : ''}</button><button aria-pressed={tab === 'files'} disabled={!plan?.hasSplit} onClick={() => setTab('files')}>Output files{fileCount ? ` · ${fileCount}` : ''}</button></div>}
      {scan && tab === 'matches' ? <section className="tool-panel text-split-matches"><div className="text-split-list-heading"><div><h3>Matching pages</h3><p>{enabled.length} of {scan.matches.length} checked</p></div><div><button className="btn btn-secondary btn-sm" disabled={busy || !scan.matches.length} onClick={() => selectMatches(scan.matches.map(match => match.page))}>Use all</button><button className="btn btn-secondary btn-sm" disabled={busy || !enabled.length} onClick={() => selectMatches([])}>Clear</button></div></div>
        {matchRows.map(match => <div key={match.page} className={`text-split-match${selected.has(match.page) ? ' included' : ''}`}><div className="text-split-match-title"><label><input type="checkbox" checked={selected.has(match.page)} disabled={busy} onChange={() => toggleMatch(match.page)} /><strong>Page {match.page}</strong></label><span>{boundaryLabel(match.page)}</span><button className="btn btn-secondary btn-sm" onClick={() => setSourcePage(match.page)}><Eye size={13} /> View page</button></div><p className="text-split-excerpt">{match.hits[0].before}<mark>{match.hits[0].matched}</mark>{match.hits[0].after}</p>{match.hits.length > 1 && <details className="text-split-more"><summary>{match.hits.length - 1} more matched {match.hits.length === 2 ? 'marker' : 'markers'}</summary>{match.hits.slice(1).map((hit, index) => <p key={index}>{hit.before}<mark>{hit.matched}</mark>{hit.after}</p>)}</details>}</div>)}
        {!matchRows.length && <div className="text-split-no-matches"><Search size={27} /><h3>No matching text found</h3><p>Copy a short phrase from the PDF and search again. This tool reads selectable text; it does not perform OCR on image-only pages.</p></div>}
        {matchSheets > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous matching pages" disabled={currentMatchSheet === 0} onClick={() => setMatchSheet(currentMatchSheet - 1)}><ChevronLeft size={15} /></button><span>{currentMatchSheet * 8 + 1}–{Math.min((currentMatchSheet + 1) * 8, scan.matches.length)} of {scan.matches.length} matches</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next matching pages" disabled={currentMatchSheet + 1 === matchSheets} onClick={() => setMatchSheet(currentMatchSheet + 1)}><ChevronRight size={15} /></button></div>}
        {scan.textlessPages.length > 0 && <p className="split-warning">{scan.textlessPages.length} {scan.textlessPages.length === 1 ? 'page has' : 'pages have'} no selectable text and could not be searched. They are still included in the output. Image-only scans need OCR first.</p>}{scan.failedPages.length > 0 && <p className="split-warning">Text could not be read on {scan.failedPages.length} {scan.failedPages.length === 1 ? 'page' : 'pages'}: {summarizeSplitPages(scan.failedPages)}. Review your split points carefully.</p>}
      </section> : scan && plan?.hasSplit && tab === 'files' ? <>
        <section className="tool-panel split-plan"><div className="text-split-list-heading"><div><h3>{outputs ? 'Download your sections' : 'Planned sections'}</h3><p>{outputs ? `${formatFileSize(outputs.reduce((sum, output) => sum + output.blob.size, 0))} total` : 'Create the PDFs to preview and download them.'}</p></div><span className={`split-plan-count${outputs ? ' ready' : ''}`}>{outputs && <Check size={12} />}{fileCount} files</span></div><ol className="split-output-list" start={currentFileSheet * 6 + 1}>{fileRows.map((pages, offset) => { const index = currentFileSheet * 6 + offset; return <li key={index}><div className="split-output-icon"><FileText size={18} /><span>{String(index + 1).padStart(2, '0')}</span></div><div className="split-output-info"><strong title={splitOutputName(prefix, index, pages, fileCount)}>{splitOutputName(prefix, index, pages, fileCount)}</strong><span>{pages.length} {pages.length === 1 ? 'page' : 'pages'} · source {summarizeSplitPages(pages)}{outputs ? ` · ${formatFileSize(outputs[index].blob.size)}` : ''}</span></div>{outputs && <div className="split-output-actions"><button className="btn btn-secondary btn-sm" onClick={() => setPreviewIndex(index)}>Preview</button><button className="btn btn-secondary btn-icon btn-sm" disabled={busy} aria-label={`Download section ${index + 1}`} onClick={() => save(index)}><Download size={14} /></button></div>}</li> })}</ol>{fileSheets > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous sections" disabled={currentFileSheet === 0} onClick={() => setFileSheet(currentFileSheet - 1)}><ChevronLeft size={15} /></button><span>Files {currentFileSheet * 6 + 1}–{Math.min((currentFileSheet + 1) * 6, fileCount)} of {fileCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next sections" disabled={currentFileSheet + 1 === fileSheets} onClick={() => setFileSheet(currentFileSheet + 1)}><ChevronRight size={15} /></button></div>}
          {skippedLinks > 0 && <p className="split-warning">{skippedLinks} internal {skippedLinks === 1 ? 'link could' : 'links could'} not be included. Their destinations must be retained in the same output PDF.</p>}{outputs?.some(output => output.signaturesCleared > 0) && <p className="split-warning">Certificate signatures cannot be transferred to new split files. Their visual appearance is retained.</p>}
        </section>{currentOutput && <div className="split-result-preview"><div className="split-result-toolbar"><div><strong>Section {previewIndex + 1} of {outputs.length}</strong><span>Source pages {summarizeSplitPages(currentOutput.pages)}</span></div><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous output PDF" disabled={previewIndex === 0} onClick={() => setPreviewIndex(previewIndex - 1)}><ChevronLeft size={15} /></button><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next output PDF" disabled={previewIndex + 1 === outputs.length} onClick={() => setPreviewIndex(previewIndex + 1)}><ChevronRight size={15} /></button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(previewIndex)}><Download size={14} /> Download</button></div></div><DocumentPdfPreview blob={currentOutput.blob} heading="Section preview" readyLabel="Matches this file’s download" /></div>}
      </> : <div className="tool-panel split-empty"><div className="text-split-empty-steps"><span><Search size={22} /> Find</span><ArrowRight size={17} /><span><Check size={22} /> Review</span><ArrowRight size={17} /><span><Scissors size={22} /> Split</span></div><h3>Find your document boundaries</h3><p>Search for a heading or marker, review the matching pages, then create separate PDFs with their original content.</p></div>}
    </div></div>
    <Modal open={sourcePage !== null} onClose={() => setSourcePage(null)} title={`Source page ${sourcePage}`} maxWidth={850}>{sourcePage !== null && source && <DocumentPdfPreview blob={source.file} initialPage={sourcePage} heading="Source page preview" readyLabel="Original document" />}</Modal>
  </div></ToolPage>
}
