import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, FileText, ScanSearch, Upload, X } from 'lucide-react';
import { ToolPage } from './ToolPage';
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui';
import { AutoRedactPreview } from './AutoRedactPreview';
import { WatermarkPdfPreview } from './WatermarkPdfPreview';
import { getPdfjsLib, loadPdfBytes } from '../services/pdfEngine';
import { createRedactedPdf, redactionTargetPages } from '../services/pdfRedaction';
import { PII_TYPES, scanPdfPii } from '../services/pdfPii';
import { useApp } from '../context/AppContext';
import './WatermarkWorkspace.css';
import './AutoRedactWorkspace.css';

const dispose = async task => { try { await task?.destroy(); } catch { /* Already cancelled. */ } };

export function AutoRedactWorkspace() {
  const { showToast } = useApp();
  const [source, setSource] = useState(null), [matches, setMatches] = useState([]), [report, setReport] = useState(null);
  const [page, setPage] = useState(1), [focused, setFocused] = useState(null), [filter, setFilter] = useState('All');
  const [pages, setPages] = useState(''), [scannedPages, setScannedPages] = useState(''), [dpi, setDpi] = useState(200);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState(null), [tab, setTab] = useState('review');
  const input = useRef(null), reading = useRef(null), operation = useRef(null), cached = useRef(null), rows = useRef(new Map());
  const locked = loading || busy, stale = pages.trim() !== scannedPages;
  const params = useMemo(() => ({ source, matches, dpi }), [source, matches, dpi]);
  const selected = matches.filter(match => match.selected);
  const listed = matches.filter(match => filter === 'All' || match.type === filter);
  const resultCurrent = result && result.params === params;
  useEffect(() => () => { dispose(source?.loadingTask); }, [source]);
  useEffect(() => () => { reading.current?.controller.abort(); dispose(reading.current?.task); reading.current = null; operation.current?.abort(); }, []);
  useEffect(() => {
    const row = rows.current.get(focused), list = row?.parentElement;
    if (!row || !list) return;
    const rect = row.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [focused, filter]);

  const invalidate = () => { cached.current = null; setResult(null); setTab('review'); setError(''); };
  const focusMatch = id => {
    const match = matches.find(item => item.id === id);
    if (!match || locked) return;
    setFocused(id); setPage(match.page); setTab('review'); setFilter('All');
  };
  const updateMatches = update => { if (!locked) { invalidate(); setMatches(update); } };
  const scan = async (active, pdfjs, controller, range) => {
    const next = await scanPdfPii(active, pdfjs, { pages: range, signal: controller.signal, onProgress: (value, label) => {
      if (operation.current === controller) { setProgress(value); setStatus(label); }
    } });
    if (controller.signal.aborted || operation.current !== controller) return;
    setMatches(next.matches); setReport(next); setScannedPages(range.trim()); setFilter('All');
    setFocused(next.matches[0]?.id || null); setPage(next.matches[0]?.page || 1);
  };
  const load = async files => {
    if (reading.current || operation.current || locked) return;
    const file = files[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Choose a PDF file.'); return; }
    if (!file.size) { setError('This PDF is empty.'); return; }
    const controller = new AbortController(), request = { task: null, controller };
    reading.current = request; operation.current = controller;
    setLoading(true); setError('');
    let active;
    try {
      const [pdfjs, bytes] = await Promise.all([getPdfjsLib(), loadPdfBytes(file)]);
      if (controller.signal.aborted) return;
      request.task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
      const pdf = await request.task.promise;
      if (controller.signal.aborted) return;
      if (!pdf.numPages) throw new Error('This PDF has no pages.');
      active = { file, pdf, loadingTask: request.task };
      setSource(active); setMatches([]); setReport(null); setPages(''); setScannedPages(''); setResult(null); cached.current = null;
      setFocused(null); setPage(1); setTab('review'); setProgress(0); setStatus('Scanning PDF…'); setLoading(false); setBusy(true);
      await scan(active, pdfjs, controller, '');
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.name === 'PasswordException' ? 'Remove this PDF’s password before scanning it.' : failure.message || 'Could not scan this PDF.');
    } finally {
      if (!active) await dispose(request.task);
      if (reading.current === request) reading.current = null;
      if (operation.current === controller) { operation.current = null; setLoading(false); setBusy(false); }
    }
  };
  const rescan = async () => {
    if (!source || locked || operation.current) return;
    try { redactionTargetPages(pages, source.pdf.numPages); } catch (failure) { setError(failure.message); return; }
    const controller = new AbortController(); operation.current = controller;
    invalidate(); setBusy(true); setProgress(0); setStatus('Scanning PDF…');
    // Clear previous detections before scanning so a cancelled or failed scan
    // can never export stale findings for a different page range.
    setMatches([]); setReport(null); setFocused(null);
    try { await scan(source, await getPdfjsLib(), controller, pages); }
    catch (failure) { if (!controller.signal.aborted) setError(failure.message || 'Could not scan this PDF.'); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  };
  const close = () => {
    if (locked || operation.current || reading.current) return;
    invalidate(); setSource(null); setMatches([]); setReport(null); setPages(''); setScannedPages(''); setFocused(null); setPage(1);
  };
  const cancel = () => {
    const readingRequest = reading.current;
    operation.current?.abort(); operation.current = null;
    if (readingRequest) {
      reading.current = null;
      // A document already handed to the workspace remains available to retry.
      if (!source || source.loadingTask !== readingRequest.task) dispose(readingRequest.task);
    }
    setLoading(false); setBusy(false); setProgress(0);
  };
  const create = async action => {
    if (!source || !report || stale || !selected.length || locked || operation.current) return;
    const filename = `redacted-${source.file.name.replace(/\.pdf$/i, '')}.pdf`;
    if (cached.current?.params === params) {
      if (action === 'preview') setTab('pdf'); else downloadBlob(cached.current.blob, filename);
      return;
    }
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(''); setProgress(0); setStatus('Applying redactions…');
    try {
      const regions = selected.flatMap(match => match.regions);
      const blob = await createRedactedPdf(source, regions, { dpi, signal: controller.signal, onProgress: (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label); }
      } });
      if (controller.signal.aborted || operation.current !== controller) return;
      const next = { params, blob }; cached.current = next; setResult(next);
      if (action === 'preview') setTab('pdf');
      else { downloadBlob(blob, filename); showToast('Redacted PDF downloaded.', 'success'); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message || 'Could not redact this PDF.'); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  };

  return <ToolPage toolId="auto-redact"><div className="pii-workspace">
    <input ref={input} hidden type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { load(Array.from(event.target.files)); event.target.value = ''; }} />
    {!source ? <div className="tool-panel pii-upload"><DropZone onFiles={load} accept={['application/pdf', '.pdf']}><ScanSearch size={32} /><div className="drop-zone-title">Choose a PDF to scan</div><div className="drop-zone-sub">Email addresses, phone numbers and PAN numbers</div></DropZone></div> : <>
      <div className="pii-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pdf.numPages} pages</span></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={locked} onClick={close} aria-label="Close PDF"><X size={17} /></button></div>
      <div className="pii-grid"><aside className="tool-panel pii-controls">
        <div className="pii-scan-controls"><FormGroup label="Scan pages"><input className="form-input" value={pages} disabled={locked} placeholder="All pages · or 1-3, 5" onChange={event => { invalidate(); setPages(event.target.value); }} /></FormGroup><button className="btn btn-secondary" disabled={locked} onClick={rescan}><ScanSearch size={15} /> {stale || !report ? 'Scan pages' : 'Scan again'}</button></div>
        <div className="pii-match-heading"><h2>Matches <span>{matches.length}</span></h2><span>{selected.length} selected</span></div>
        <div className="pii-filters" role="group" aria-label="Filter detected matches">{['All', ...PII_TYPES].map(type => <button key={type} disabled={locked} aria-pressed={filter === type} onClick={() => setFilter(type)}>{type}<span>{type === 'All' ? matches.length : matches.filter(match => match.type === type).length}</span></button>)}</div>
        <div className="pii-select-actions"><button disabled={locked || !listed.some(match => !match.selected)} onClick={() => updateMatches(previous => previous.map(match => filter === 'All' || match.type === filter ? { ...match, selected: true } : match))}>Select {filter === 'All' ? 'all' : filter}</button><button disabled={locked || !listed.some(match => match.selected)} onClick={() => updateMatches(previous => previous.map(match => filter === 'All' || match.type === filter ? { ...match, selected: false } : match))}>Deselect {filter === 'All' ? 'all' : filter}</button></div>
        <div className="pii-matches" aria-label="Detected personal information">{listed.map(match => <div key={match.id} ref={element => { if (element) rows.current.set(match.id, element); else rows.current.delete(match.id); }} className={`pii-match-row${focused === match.id ? ' focused' : ''}`}><input type="checkbox" checked={match.selected} disabled={locked} aria-label={`Redact ${match.type} ${match.value} on page ${match.page}`} onChange={() => updateMatches(previous => previous.map(item => item.id === match.id ? { ...item, selected: !item.selected } : item))} /><button disabled={locked} onClick={() => focusMatch(match.id)}><strong>{match.value}</strong><span>{match.type} · Page {match.page}</span></button></div>)}{!listed.length && <p className="pii-empty">{busy ? 'Scanning…' : !report ? 'Scan the PDF to find matches.' : !matches.length ? 'No matching patterns found. Check the pages manually.' : 'No matches in this category.'}</p>}</div>
        {report?.imagePages.length > 0 && <p className="pii-note" role="status">{report.imagePages.length} {report.imagePages.length === 1 ? 'page has' : 'pages have'} no searchable text. Images need OCR or <a href="/redact-pdf">manual redaction</a>.</p>}
        <p className="pii-note">Review the highlights; patterns can miss information. <a href="/redact-pdf">Mark other areas</a></p>
        <FormGroup label="Export quality"><select className="form-select" value={dpi} disabled={locked} onChange={event => { invalidate(); setDpi(Number(event.target.value)); }}><option value={150}>Standard · 150 DPI</option><option value={200}>High · 200 DPI</option><option value={300}>Print · 300 DPI</option></select></FormGroup>
        <button className="btn btn-secondary pii-export" disabled={locked || !report || stale || !selected.length} onClick={() => create('preview')}><Eye size={16} /> Preview redacted PDF</button>
        <button className="btn btn-primary pii-export" disabled={locked || !report || stale || !selected.length} onClick={() => create('download')}><Download size={16} /> Redact & Download{selected.length ? ` (${selected.length})` : ''}</button>
        <p className="pii-output-note">Exported pages become images; original text, links and form fields are removed.</p>
      </aside><section className="pii-review" aria-label="Review redaction matches"><div className="pii-review-tabs"><button aria-pressed={tab === 'review'} onClick={() => setTab('review')}>Review matches</button>{resultCurrent && <button aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>Redacted PDF</button>}</div>
        {tab === 'pdf' && resultCurrent ? <WatermarkPdfPreview blob={result.blob} page={page} pageCount={source.pdf.numPages} onPage={setPage} label="Redacted PDF" /> : <><AutoRedactPreview source={source} page={page} matches={matches} focused={focused} onFocus={focusMatch} disabled={locked} /><div className="pii-navigation"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => { setPage(page - 1); setFocused(null); }}><ChevronLeft size={16} /></button><label>Page <input className="form-input" type="number" min={1} max={source.pdf.numPages} step={1} value={page} onChange={event => { setPage(Math.max(1, Math.min(source.pdf.numPages, Math.trunc(Number(event.target.value)) || 1))); setFocused(null); }} /> of {source.pdf.numPages}</label><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next page" disabled={page >= source.pdf.numPages} onClick={() => { setPage(page + 1); setFocused(null); }}><ChevronRight size={16} /></button></div></>}
      </section></div>
    </>}
    {locked && <div className="pii-progress"><ProgressBar value={loading ? null : progress} label={loading ? 'Opening PDF…' : status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="pii-error" role="alert">{error}</p>}
  </div></ToolPage>;
}
