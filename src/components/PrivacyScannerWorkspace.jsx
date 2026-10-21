import { useEffect, useRef, useState } from 'react';
import { Download, FileText, RotateCcw, Search, Upload, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ToolPage } from './ToolPage';
import { DropZone, ProgressBar, downloadBlob, formatBytes } from './ui';
import { getPdfjsLib, loadPdfBytes } from '../services/pdfEngine';
import { scanPdfPrivacy } from '../services/pdfPrivacy';
import './PrivacyScannerWorkspace.css';

const dispose = async task => { try { await task?.destroy(); } catch { /* A cancelled task may already be closed. */ } };
const actions = {
  'auto-redact': ['Open Auto-Redact', '/auto-redact'],
  'edit-metadata': ['Open metadata editor', '/edit-metadata'],
  'redact-pdf': ['Open Redact PDF', '/redact-pdf'],
};

export function PrivacyScannerWorkspace() {
  const [file, setFile] = useState(null), [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [category, setCategory] = useState('All'), [severity, setSeverity] = useState('all'), [search, setSearch] = useState(''), [visible, setVisible] = useState(30);
  const input = useRef(null), operation = useRef(null);
  useEffect(() => () => { const request = operation.current; operation.current = null; request?.controller.abort(); dispose(request?.task); }, []);
  useEffect(() => { setVisible(30); }, [category, severity, search, report]);

  const scan = async files => {
    if (operation.current) return;
    const selected = files[0];
    if (!selected) return;
    if (selected.type !== 'application/pdf' && !/\.pdf$/i.test(selected.name)) { setError('Choose a PDF file.'); return; }
    if (!selected.size) { setError('This PDF is empty.'); return; }
    const request = { controller: new AbortController(), task: null };
    operation.current = request;
    setFile(selected); setReport(null); setError(''); setBusy(true); setProgress(0); setStatus('Opening PDF…');
    setCategory('All'); setSeverity('all'); setSearch('');
    try {
      const [pdfjs, bytes] = await Promise.all([getPdfjsLib(), loadPdfBytes(selected)]);
      if (request.controller.signal.aborted) return;
      request.task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
      const pdf = await request.task.promise;
      if (!pdf.numPages) throw new Error('This PDF has no pages.');
      const next = await scanPdfPrivacy(pdf, { signal: request.controller.signal, onProgress: (value, label) => {
        if (operation.current === request) { setProgress(value); setStatus(label); }
      } });
      if (operation.current !== request || request.controller.signal.aborted) return;
      setReport(next);
    } catch (failure) {
      if (operation.current === request && !request.controller.signal.aborted) {
        setError(failure.name === 'PasswordException' ? 'Remove this PDF’s opening password before scanning it.' : failure.message || 'Could not scan this PDF.');
      }
    } finally {
      await dispose(request.task);
      if (operation.current === request) { operation.current = null; setBusy(false); }
    }
  };
  const cancel = () => {
    const request = operation.current;
    operation.current = null; request?.controller.abort(); dispose(request?.task);
    setBusy(false); setReport(null); setStatus('Scan cancelled.');
  };
  const reset = () => { if (!operation.current) { setFile(null); setReport(null); setError(''); setStatus(''); setProgress(0); } };
  const exportReport = () => {
    if (!report || !file || busy) return;
    const data = { filename: file.name, fileSize: file.size, ...report };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `privacy-report-${file.name.replace(/\.pdf$/i, '')}.json`);
  };
  const findings = report?.findings || [];
  const categories = ['All', ...new Set(findings.map(finding => finding.category))];
  const counts = { high: findings.filter(item => item.severity === 'high').length, medium: findings.filter(item => item.severity === 'medium').length, info: findings.filter(item => item.severity === 'info').length };
  const query = search.trim().toLowerCase();
  const filtered = findings.filter(item => (category === 'All' || item.category === category) && (severity === 'all' || item.severity === severity) && (!query || [item.title, item.value, ...item.locations, ...item.pages.map(page => `page ${page}`)].join(' ').toLowerCase().includes(query)));
  const limited = report && (report.incomplete || report.truncated || report.noTextPages.length > 0);

  return <ToolPage toolId="privacy-scanner"><div className="privacy-workspace">
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => { scan(Array.from(event.target.files)); event.target.value = ''; }} />
    {!file ? <div className="tool-panel privacy-upload"><DropZone onFiles={scan} accept={['application/pdf', '.pdf']}><Zap size={32} /><div className="drop-zone-title">Choose a PDF to scan</div><div className="drop-zone-sub">Checks run locally on your device</div></DropZone></div> : <>
      <div className="privacy-filebar"><FileText size={20} /><div><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)}{report ? ` · ${report.pageCount} pages` : ''}</span></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => scan([file])}><RotateCcw size={14} /> Scan again</button><button className="icon-btn" disabled={busy} onClick={reset} aria-label="Close PDF"><X size={17} /></button></div>
      {report && <>
        <div className="privacy-summary"><div><Zap size={21} /><div><h2>{counts.high ? 'Review high-priority findings' : counts.medium ? 'Review findings before sharing' : limited ? 'Review scan coverage' : 'No higher-priority findings detected'}</h2><p>{report.textPages} of {report.pageCount} pages contain searchable text · The original PDF is unchanged</p></div></div><button className="btn btn-secondary btn-sm" onClick={exportReport}><Download size={15} /> Download report</button></div>
        <div className="privacy-counts" role="group" aria-label="Filter by priority">{[['all', 'All findings', findings.length], ['high', 'High priority', counts.high], ['medium', 'Review', counts.medium], ['info', 'Information', counts.info]].map(([value, label, count]) => <button key={value} className={`privacy-count ${value}`} aria-pressed={severity === value} onClick={() => setSeverity(value)}><strong>{count}{report.truncated && value === 'all' ? '+' : ''}</strong><span>{label}</span></button>)}</div>
        {limited && <div className="privacy-coverage" role="status">
          {report.noTextPages.length > 0 && <p>{report.noTextPages.length} {report.noTextPages.length === 1 ? 'page has' : 'pages have'} no searchable page text. Image content was not OCR-scanned.{report.noTextPages.length <= 15 ? ` Pages: ${report.noTextPages.join(', ')}.` : ''}</p>}
          {report.incomplete && <p>Some checks could not finish. Review scan details below.</p>}
          {report.truncated && <p>Only the first 5,000 distinct findings are listed.</p>}
        </div>}
        <div className="privacy-grid"><aside className="privacy-sidebar"><nav className="tool-panel privacy-categories" aria-label="Finding categories">{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}><span>{value}</span><b>{value === 'All' ? findings.length : findings.filter(item => item.category === value).length}</b></button>)}</nav><div className="privacy-tools"><h3>Review & clean up</h3><Link to="/auto-redact">Auto-Redact PII</Link><Link to="/edit-metadata">Edit metadata</Link><Link to="/redact-pdf">Redact selected areas</Link></div></aside>
          <section className="privacy-results" aria-label="Privacy findings"><div className="privacy-results-heading"><h2>Findings <span>{filtered.length}</span></h2><label className="privacy-search"><Search size={15} /><input className="form-input" type="search" placeholder="Search findings" aria-label="Search findings" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
            {filtered.slice(0, visible).map(item => <article className={`privacy-finding ${item.severity}`} key={item.id}><div className="privacy-finding-heading"><h3>{item.title}</h3><span className={`privacy-badge ${item.severity}`}>{item.severity === 'high' ? 'High' : item.severity === 'medium' ? 'Review' : 'Info'}</span></div><p className="privacy-finding-value">{item.value}</p><div className="privacy-finding-location"><span>{item.locations.join(' · ')}</span>{item.pages.length > 0 && <span>Pages {item.pages.slice(0, 25).join(', ')}{item.pages.length > 25 ? ` +${item.pages.length - 25} more` : ''}</span>}</div>{actions[item.action] && <Link className="privacy-finding-action" to={actions[item.action][1]}>{actions[item.action][0]}</Link>}</article>)}
            {!filtered.length && <div className="privacy-empty">{findings.length ? 'No findings match these filters.' : 'No findings from the completed checks. Images and hidden content still need manual review.'}</div>}
            {filtered.length > visible && <button className="btn btn-secondary privacy-more" onClick={() => setVisible(value => value + 30)}>Show more · {filtered.length - visible} remaining</button>}
          </section>
        </div>
        <details className="tool-panel privacy-details"><summary>Scan details & document metadata</summary><div className="privacy-checks"><div><strong>{report.annotationCount}</strong> annotations</div><div><strong>{report.fieldCount}</strong> form fields</div><div><strong>{report.attachmentCount}</strong> attachments</div><div><strong>{report.linkCount}</strong> external references</div></div>
          <ul className="privacy-check-list">{report.checks.map(item => <li key={item.label}><span>{item.label}</span><span className={item.failed ? 'privacy-check-failed' : ''}>{item.failed ? `${item.failed} failed${item.failedPages.length && item.failedPages.length <= 15 ? ` · pages ${item.failedPages.join(', ')}` : ''}` : 'Completed'}</span></li>)}</ul>
          {report.metadata.length > 0 && <div className="privacy-metadata-scroll"><table><caption>Embedded metadata</caption><tbody>{report.metadata.map((item, index) => <tr key={index}><th scope="row">{item.name}<small>{item.kind}</small></th><td>{item.value}</td></tr>)}</tbody></table></div>}
        </details>
        <p className="privacy-limitations">Patterns can miss information. Images and unsupported structures need manual review; this scan does not certify a PDF safe.</p>
      </>}
      {!busy && !report && !error && status && <p className="privacy-status" role="status">{status}</p>}
    </>}
    {busy && <div className="privacy-progress"><ProgressBar value={progress || null} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="privacy-error" role="alert">{error}</p>}
  </div></ToolPage>;
}
