import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookMarked, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, FolderArchive, Link2, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, Modal, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { formatFileSize } from '../services/pdfEngine'
import { readSplitSource, splitLoadedPdf, summarizeSplitPages } from '../services/pdfSplit'
import { bookmarkNamePart, bookmarkOutputName, buildBookmarkSplitPlan, readBookmarkIndex, selectBookmarkLevel, validBookmarkPage } from '../services/pdfBookmarkSplit'
import '../pages/tools/SplitPdf.css'
import './SplitByBookmarksWorkspace.css'

export function SplitByBookmarksWorkspace() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [source, setSource] = useState(null), [index, setIndex] = useState(null)
  const [entries, setEntries] = useState([]), [selectedIds, setSelectedIds] = useState([]), [level, setLevel] = useState('1')
  const [frontMatter, setFrontMatter] = useState('separate'), [keepBookmarks, setKeepBookmarks] = useState(true)
  const [prefix, setPrefix] = useState(''), [naming, setNaming] = useState('source-title'), [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0)
  const [status, setStatus] = useState(''), [error, setError] = useState(''), [outputs, setOutputs] = useState(null)
  const [tab, setTab] = useState('bookmarks'), [bookmarkSheet, setBookmarkSheet] = useState(0), [sectionSheet, setSectionSheet] = useState(0)
  const [previewIndex, setPreviewIndex] = useState(0), [sourcePage, setSourcePage] = useState(null)
  const reading = useRef(null), operation = useRef(null)
  useEffect(() => () => { reading.current?.abort(); operation.current?.abort() }, [])

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const { plan, planError } = useMemo(() => {
    if (!source) return { plan: null, planError: '' }
    try { return { plan: buildBookmarkSplitPlan(source.pageCount, entries, selectedIds, { frontMatter }), planError: '' } }
    catch (error) { return { plan: null, planError: error.message } }
  }, [source, entries, selectedIds, frontMatter])
  const visible = useMemo(() => {
    const query = filter.normalize('NFKC').trim().toLowerCase()
    return entries.filter(entry => !query || [...entry.parents, entry.title].join(' ').normalize('NFKC').toLowerCase().includes(query))
  }, [entries, filter])
  const usableCount = source ? entries.filter(entry => validBookmarkPage(entry, source.pageCount)).length : 0
  const lock = busy || loading
  const invalidate = () => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setOutputs(null); setPreviewIndex(0); setSectionSheet(0); setTab('bookmarks'); setError(''); setStatus(''); setProgress(0)
  }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reading.current?.abort(); invalidate(); setSourcePage(null)
    const controller = new AbortController(); reading.current = controller
    setFile(next); setSource(null); setIndex(null); setEntries([]); setSelectedIds([]); setFilter(''); setBookmarkSheet(0)
    setPrefix(next.name.replace(/\.pdf$/i, '')); setLoading(true); setStatus('Opening your PDF')
    try {
      const loaded = await readSplitSource(next, controller.signal)
      if (controller.signal.aborted || reading.current !== controller) return
      setProgress(10); setStatus('Reading the bookmark outline')
      const bookmarks = await readBookmarkIndex(loaded, { signal: controller.signal, onProgress: (value, label) => { if (reading.current === controller) { setProgress(10 + value * .9); setStatus(label) } } })
      if (controller.signal.aborted || reading.current !== controller) return
      const validDepths = bookmarks.entries.filter(entry => validBookmarkPage(entry, loaded.pageCount)).map(entry => entry.depth)
      const initialLevel = String(validDepths.length ? validDepths.reduce((minimum, depth) => Math.min(minimum, depth), Infinity) : bookmarks.depths[0] || 1)
      setSource(loaded); setIndex(bookmarks); setEntries(bookmarks.entries); setLevel(initialLevel)
      setSelectedIds(selectBookmarkLevel(bookmarks.entries, initialLevel, loaded.pageCount)); setProgress(100); setStatus('Bookmarks ready to review')
    } catch (failure) { if (!controller.signal.aborted && reading.current === controller) setError(failure.message || 'Could not read the bookmarks in this PDF.') }
    finally { if (reading.current === controller) setLoading(false) }
  }
  const reset = () => {
    reading.current?.abort(); reading.current = null; invalidate()
    setFile(null); setSource(null); setIndex(null); setEntries([]); setSelectedIds([]); setLevel('1'); setFilter(''); setPrefix(''); setLoading(false); setSourcePage(null); setBookmarkSheet(0)
    setFrontMatter('separate'); setKeepBookmarks(true); setNaming('source-title')
  }
  const chooseLevel = value => {
    invalidate(); setLevel(value)
    if (source && value !== 'manual') setSelectedIds(selectBookmarkLevel(entries, value, source.pageCount))
  }
  const toggle = id => { invalidate(); setLevel('manual'); setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]) }
  const selectVisible = include => {
    if (!source) return
    invalidate(); setLevel('manual')
    const ids = new Set(visible.filter(entry => validBookmarkPage(entry, source.pageCount)).map(entry => entry.id))
    if (include) setSelectedIds(current => [...new Set([...current, ...ids])])
    else { const allVisible = new Set(visible.map(entry => entry.id)); setSelectedIds(current => current.filter(id => !allVisible.has(id))) }
  }
  const editPage = (entry, rawValue, restore = false) => {
    if (!source) return
    const page = rawValue === '' || rawValue === null ? null : Number(rawValue)
    invalidate(); setLevel('manual'); setEntries(current => current.map(item => item.id === entry.id ? { ...item, page } : item))
    if (validBookmarkPage({ page }, source.pageCount)) setSelectedIds(current => current.includes(entry.id) ? current : [...current, entry.id])
    else if (restore) setSelectedIds(current => current.filter(id => id !== entry.id))
  }
  const create = async () => {
    if (!source || !plan?.hasSplit || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setOutputs(null); setProgress(0); setStatus('Creating bookmarked sections')
    try {
      const results = await splitLoadedPdf(source, plan.groups, { signal: controller.signal, bookmarks: keepBookmarks ? entries.filter(entry => validBookmarkPage(entry, source.pageCount)) : null, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      setOutputs(results); setPreviewIndex(0); setSectionSheet(0); setTab('sections')
      showToast(`${results.length} sections ready to preview and download.`, 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the bookmark sections.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const filename = position => bookmarkOutputName(prefix, plan.sections[position], position, outputs.length, naming)
  const save = position => { if (outputs?.[position]) downloadBlob(outputs[position].blob, filename(position)) }
  const downloadAll = async () => {
    if (!outputs?.length || operation.current) return
    if (outputs.length === 1) { save(0); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing ZIP download')
    try {
      const JSZip = (await import('jszip')).default
      if (controller.signal.aborted) return
      const zip = new JSZip()
      outputs.forEach((output, position) => zip.file(filename(position), output.blob))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, ({ percent }) => {
        if (controller.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
        if (operation.current === controller) setProgress(percent)
      })
      if (controller.signal.aborted || operation.current !== controller) return
      downloadBlob(blob, `${bookmarkNamePart(prefix, 'document')}-bookmark-sections.zip`); setStatus('ZIP downloaded')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Download the PDFs individually instead.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => {
    if (loading) { reading.current?.abort(); reading.current = null; setLoading(false) }
    operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0); setStatus('Cancelled. Choose the PDF again to reload, or change your split settings.')
  }
  const bookmarkSheets = Math.max(1, Math.ceil(visible.length / 10)), currentBookmarkSheet = Math.min(bookmarkSheet, bookmarkSheets - 1)
  const bookmarkRows = visible.slice(currentBookmarkSheet * 10, currentBookmarkSheet * 10 + 10)
  const sectionCount = plan?.fileCount || 0, sectionSheets = Math.max(1, Math.ceil(sectionCount / 6)), currentSectionSheet = Math.min(sectionSheet, sectionSheets - 1)
  const sectionRows = plan?.sections.slice(currentSectionSheet * 6, currentSectionSheet * 6 + 6) || []
  const currentOutput = outputs?.[previewIndex], currentSection = plan?.sections[previewIndex]
  const skippedLinks = outputs?.reduce((sum, output) => sum + output.skippedLinks, 0) || 0

  return <ToolPage toolId="split-by-bookmarks"><div className="split-workspace bookmark-split">
    <div className="split-promises"><span><BookMarked size={15} /> Chapters and nested bookmarks</span><span><Link2 size={15} /> Original pages and supported links</span><span><ShieldCheck size={15} /> Processed in your browser</span></div>
    <div className="tool-panel split-upload-panel"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`split-upload${file ? ' has-file' : ''}`}><div className="split-upload-icon"><BookMarked size={26} /></div><div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF with bookmarks'}</div><div className="drop-zone-sub">Drop your file here or click to browse</div></div></DropZone>{file && <FileItem file={file} onRemove={reset} meta={source ? `${source.pageCount} pages · ${entries.length} bookmarks` : loading ? 'Reading bookmarks…' : 'Choose again to reload'} />}{loading && <p className="split-loading" role="status"><LoaderCircle size={15} className="split-spin" /> {status}</p>}</div>
    <div className="split-layout"><div className="tool-panel split-settings">
      <div className="split-panel-heading"><span className="split-step">01</span><div><h2>Choose your split points</h2><p>Use a bookmark level or select entries yourself.</p></div></div>
      <FormGroup label="Bookmark selection"><select className="form-select" value={level} disabled={lock || !index?.hasOutline} onChange={event => chooseLevel(event.target.value)}>{(index?.depths.length ? index.depths : [1]).map(depth => <option key={depth} value={String(depth)}>Level {depth}{depth === 1 ? ' · top-level chapters' : ' · nested entries'}</option>)}<option value="all">All bookmark levels</option><option value="manual">Choose manually</option></select></FormGroup>
      <p className="split-hint">Checked bookmarks start new files. Sections follow source page order, even when the outline is arranged differently.</p>
      <div className="bookmark-settings-divider"><FormGroup label="Pages before the first chosen bookmark"><select className="form-select" value={frontMatter} disabled={lock} onChange={event => { invalidate(); setFrontMatter(event.target.value) }}><option value="separate">Keep as a separate front-matter PDF</option><option value="attach">Include in the first section</option></select></FormGroup><label className="bookmark-check"><input type="checkbox" checked={keepBookmarks} disabled={lock} onChange={event => { invalidate(); setKeepBookmarks(event.target.checked) }} /> Keep relevant bookmarks in each output</label><p className="split-hint">All source pages are retained. Multiple bookmarks on the same page create one section start.</p></div>
      <div className="split-filename-field"><FormGroup label="Download filenames"><select className="form-select" value={naming} disabled={busy} onChange={event => setNaming(event.target.value)}><option value="source-title">Source name + bookmark title</option><option value="title">Number + bookmark title</option><option value="pages">Source name + page range</option></select></FormGroup><label className="form-label" htmlFor="bookmark-filename">Source name / prefix</label><input id="bookmark-filename" className="form-input" maxLength={90} value={prefix} disabled={busy} onChange={event => setPrefix(event.target.value)} placeholder="document" /><p className="split-hint">Filenames include a unique section number and safe characters.</p></div>
      {planError && <p className="split-error" role="alert">{planError}</p>}{error && <p className="split-error" role="alert">{error}</p>}
      <div className="split-main-actions"><button className="btn btn-primary btn-lg" disabled={!plan?.hasSplit || lock} onClick={create}><BookMarked size={18} />{busy ? 'Working…' : outputs ? 'Recreate section PDFs' : 'Create section PDFs'}<ArrowRight size={17} /></button><button className="btn btn-secondary" disabled={!outputs || busy} onClick={downloadAll}><FolderArchive size={17} /> Download all PDFs · ZIP</button></div>
      {(busy || loading) && <div className="split-progress"><ProgressBar value={progress} label={status || 'Processing bookmarks'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}{!busy && !loading && status && !outputs && <p className="split-hint" role="status">{status}</p>}
      <button className="split-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
    </div><div className="split-review">
      <section className="tool-panel bookmark-summary" aria-live="polite"><div className="split-panel-heading"><span className="split-step">02</span><div><h2>{outputs ? 'Your bookmark sections are ready' : 'Review the outline and page ranges'}</h2><p>{source ? `${usableCount} of ${entries.length} bookmarks have usable page targets.` : 'Add a PDF to inspect its bookmark structure.'}</p></div></div><div className="bookmark-stats"><div><strong>{source ? selectedIds.length : '—'}</strong><span>chosen bookmarks</span></div><div><strong>{source ? sectionCount : '—'}</strong><span>planned PDFs</span></div><div><strong>{source?.pageCount || '—'}</strong><span>source pages retained</span></div></div>
        {source && index?.hasOutline && !planError && !plan?.hasSplit && <p className="bookmark-info">{!selectedIds.length ? 'Select bookmarks with valid page targets to build your section plan.' : 'These bookmarks form one section covering the whole PDF. Choose another bookmark on a later page, or keep front matter as a separate file, to create a split.'}</p>}
        {plan?.samePageCount > 0 && <p className="split-hint">{plan.samePageCount} selected {plan.samePageCount === 1 ? 'bookmark shares' : 'bookmarks share'} a target page. They are grouped into one section start; no empty files are created.</p>}{plan?.frontMatterPages > 0 && <p className="split-hint">{plan.frontMatterPages} {plan.frontMatterPages === 1 ? 'page precedes' : 'pages precede'} the first selected bookmark and will be {frontMatter === 'separate' ? 'saved as Front matter' : 'included in the first section'}.</p>}
      </section>
      {index?.hasOutline && <div className="split-preview-tabs" aria-label="Bookmark split workspace"><button aria-pressed={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>Bookmark outline</button><button aria-pressed={tab === 'sections'} disabled={!plan?.sections.length} onClick={() => setTab('sections')}>Sections{sectionCount ? ` · ${sectionCount}` : ''}</button></div>}
      {index?.hasOutline && tab === 'bookmarks' ? <section className="tool-panel bookmark-outline"><div className="bookmark-list-heading"><div><h3>Bookmark outline</h3><p>Select split points or correct their source page numbers.</p></div></div><label className="split-sr-only" htmlFor="bookmark-filter">Filter bookmark titles</label><div className="bookmark-filter"><input id="bookmark-filter" className="form-input" value={filter} onChange={event => { setFilter(event.target.value); setBookmarkSheet(0) }} placeholder="Filter bookmark titles…" /><button className="btn btn-secondary btn-sm" disabled={lock || !visible.length} onClick={() => selectVisible(true)}>Select visible</button><button className="btn btn-secondary btn-sm" disabled={lock || !visible.length} onClick={() => selectVisible(false)}>Clear visible</button></div><p className="bookmark-filter-hint">Filtering changes this list only. Your chosen split points stay selected.</p>
        <ol className="bookmark-tree-list" start={currentBookmarkSheet * 10 + 1}>{bookmarkRows.map(entry => {
          const valid = validBookmarkPage(entry, source.pageCount), changed = entry.page !== entry.originalPage
          return <li key={entry.id} className={selected.has(entry.id) ? 'chosen' : ''} style={{ '--bookmark-indent': `${Math.min(entry.depth - 1, 4) * 11}px` }}><div className="bookmark-entry-main"><label><input type="checkbox" checked={selected.has(entry.id)} disabled={lock || (!valid && !selected.has(entry.id))} onChange={() => toggle(entry.id)} /><BookMarked size={15} /><span><strong>{entry.title}</strong>{entry.parents.length > 0 && <small title={entry.parents.join(' / ')}>{entry.parents.join(' / ')}</small>}</span></label><span className="bookmark-level">Level {entry.depth}</span></div><div className="bookmark-entry-target"><div><label htmlFor={`bookmark-page-${entry.id}`}>Source page</label><input id={`bookmark-page-${entry.id}`} className="form-input" type="number" min={1} max={source.pageCount} step={1} value={entry.page ?? ''} aria-invalid={selected.has(entry.id) && !valid} disabled={lock} onChange={event => editPage(entry, event.target.value)} placeholder="—" />{changed && <button className="icon-btn" disabled={lock} aria-label={`Restore original target for ${entry.title}`} title="Restore original page" onClick={() => editPage(entry, entry.originalPage, true)}><RotateCcw size={12} /></button>}</div>{valid ? <button className="btn btn-secondary btn-sm" onClick={() => setSourcePage(entry.page)}><Eye size={13} /> View page</button> : <span className="bookmark-target-issue">{entry.issue || 'Enter a valid source page'}</span>}</div></li>
        })}</ol>{!bookmarkRows.length && <p className="bookmark-info">No bookmark titles match your filter. Clear it to see the complete outline.</p>}
        {bookmarkSheets > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous bookmark entries" disabled={currentBookmarkSheet === 0} onClick={() => setBookmarkSheet(currentBookmarkSheet - 1)}><ChevronLeft size={15} /></button><span>{currentBookmarkSheet * 10 + 1}–{Math.min((currentBookmarkSheet + 1) * 10, visible.length)} of {visible.length} bookmarks</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next bookmark entries" disabled={currentBookmarkSheet + 1 === bookmarkSheets} onClick={() => setBookmarkSheet(currentBookmarkSheet + 1)}><ChevronRight size={15} /></button></div>}
        {usableCount < entries.length && <p className="split-warning">Some bookmarks have no usable internal page target. They are excluded until you enter a valid source page. Nested entries can still be selected.</p>}
      </section> : index?.hasOutline && tab === 'sections' && plan ? <>
        <section className="tool-panel split-plan"><div className="bookmark-list-heading"><div><h3>{outputs ? 'Download your sections' : 'Planned sections'}</h3><p>{outputs ? `${formatFileSize(outputs.reduce((sum, output) => sum + output.blob.size, 0))} total` : 'Every source page appears once, in source page order.'}</p></div><span className={`split-plan-count${outputs ? ' ready' : ''}`}>{outputs && <Check size={12} />}{sectionCount} files</span></div><ol className="split-output-list" start={currentSectionSheet * 6 + 1}>{sectionRows.map((section, offset) => { const position = currentSectionSheet * 6 + offset; return <li key={position}><div className="split-output-icon"><FileText size={18} /><span>{String(position + 1).padStart(2, '0')}</span></div><div className="split-output-info"><strong title={bookmarkOutputName(prefix, section, position, sectionCount, naming)}>{bookmarkOutputName(prefix, section, position, sectionCount, naming)}</strong><span title={section.aliases.join(', ')}>{section.pages.length} {section.pages.length === 1 ? 'page' : 'pages'} · source {summarizeSplitPages(section.pages)}{section.aliases.length ? ` · +${section.aliases.length} bookmarks on the same page` : ''}{outputs ? ` · ${formatFileSize(outputs[position].blob.size)}` : ''}</span></div><div className="split-output-actions">{outputs ? <><button className="btn btn-secondary btn-sm" onClick={() => setPreviewIndex(position)}>Preview</button><button className="btn btn-secondary btn-icon btn-sm" aria-label={`Download section ${position + 1}`} disabled={busy} onClick={() => save(position)}><Download size={14} /></button></> : <button className="btn btn-secondary btn-sm" onClick={() => setSourcePage(section.start)}><Eye size={13} /> View start</button>}</div></li> })}</ol>{sectionSheets > 1 && <div className="split-plan-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous planned sections" disabled={currentSectionSheet === 0} onClick={() => setSectionSheet(currentSectionSheet - 1)}><ChevronLeft size={15} /></button><span>Files {currentSectionSheet * 6 + 1}–{Math.min((currentSectionSheet + 1) * 6, sectionCount)} of {sectionCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next planned sections" disabled={currentSectionSheet + 1 === sectionSheets} onClick={() => setSectionSheet(currentSectionSheet + 1)}><ChevronRight size={15} /></button></div>}
          {skippedLinks > 0 && <p className="split-warning">{skippedLinks} internal {skippedLinks === 1 ? 'link could' : 'links could'} not be included. Their destinations must be retained in the same output PDF.</p>}{outputs?.some(output => output.signaturesCleared > 0) && <p className="split-warning">Certificate signatures cannot be transferred to new split PDFs. Their visible appearance is retained.</p>}
        </section>{currentOutput && <div className="split-result-preview"><div className="split-result-toolbar"><div><strong>{currentSection.title}</strong><span>Section {previewIndex + 1} of {outputs.length} · {currentOutput.bookmarksRetained} bookmarks retained</span></div><div><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous section preview" disabled={previewIndex === 0} onClick={() => setPreviewIndex(previewIndex - 1)}><ChevronLeft size={15} /></button><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next section preview" disabled={previewIndex + 1 === outputs.length} onClick={() => setPreviewIndex(previewIndex + 1)}><ChevronRight size={15} /></button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(previewIndex)}><Download size={14} /> Download</button></div></div><DocumentPdfPreview blob={currentOutput.blob} heading="Section PDF preview" readyLabel="Matches this file’s download" /></div>}
      </> : <div className="tool-panel split-empty"><div className="bookmark-empty-icon"><BookMarked size={35} /></div><h3>{index && !index.hasOutline ? 'This PDF has no bookmarks' : 'Turn chapters into separate PDFs'}</h3><p>{index && !index.hasOutline ? 'This tool needs an existing bookmark outline. Use page selection or text markers to split this document instead.' : 'Inspect bookmark levels, choose your section starts, and preview the results before downloading.'}</p>{index && !index.hasOutline && <div className="bookmark-alternatives"><Link className="btn btn-secondary" to="/split-pdf">Split by pages</Link><Link className="btn btn-secondary" to="/split-by-text">Split by text</Link></div>}</div>}
    </div></div>
    <Modal open={sourcePage !== null} onClose={() => setSourcePage(null)} title={`Source page ${sourcePage}`} maxWidth={850}>{sourcePage !== null && source && <DocumentPdfPreview blob={source.file} initialPage={sourcePage} heading="Source page preview" readyLabel="Original document" />}</Modal>
  </div></ToolPage>
}
