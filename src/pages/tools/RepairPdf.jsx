import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image, Type, Upload, Wrench, X } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from '../../components/ui';
import { WatermarkPdfPreview } from '../../components/WatermarkPdfPreview';
import { repairPdf } from '../../services/pdfRepair';
import '../../components/WatermarkWorkspace.css';
import './RepairPdf.css';

export default function RepairPdf() {
  const [file, setFile] = useState(null), [mode, setMode] = useState('structure'), [dpi, setDpi] = useState(200);
  const [result, setResult] = useState(null), [page, setPage] = useState(1);
  const [textOrder, setTextOrder] = useState('content');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('');
  const input = useRef(null), operation = useRef(null);
  useEffect(() => () => { operation.current?.abort(); operation.current = null; }, []);
  const clearResult = () => { setResult(null); setPage(1); setError(''); setStatus(''); };
  const start = async (selected, method = mode) => {
    if (!selected || operation.current) return;
    if (selected.type !== 'application/pdf' && !/\.pdf$/i.test(selected.name)) { setError('Choose a PDF file.'); return; }
    if (!selected.size) { setError('This file is empty. There is no PDF content to recover.'); return; }
    if (selected.size > 256 * 1024 * 1024) { setError('Choose a PDF up to 256 MB for repair.'); return; }
    const controller = new AbortController(); operation.current = controller;
    clearResult(); setFile(selected); setMode(method); setBusy(true); setProgress(0); setStatus('Preparing PDF…');
    try {
      const repaired = await repairPdf(selected, { mode: method, dpi, textOrder, signal: controller.signal, onProgress: (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label); }
      } });
      if (controller.signal.aborted || operation.current !== controller) return;
      setResult(repaired); setPage(1);
    } catch (failure) {
      if (!controller.signal.aborted && operation.current === controller) setError(failure.message || 'This PDF could not be repaired.');
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  };
  const choose = files => { if (files[0]) start(files[0]); };
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setStatus('Repair cancelled.'); };
  const close = () => { if (!operation.current) { clearResult(); setFile(null); } };
  const download = () => {
    if (!result || busy) return;
    const prefix = result.mode === 'text' ? 'readable-text' : result.mode === 'rebuild' ? 'recovered' : 'repaired';
    downloadBlob(result.blob, `${prefix}-${file.name.replace(/\.pdf$/i, '')}.pdf`);
  };

  return <ToolPage toolId="repair-pdf"><div className="repair-workspace">
    <input ref={input} type="file" hidden accept="application/pdf,.pdf" disabled={busy} onChange={event => { choose(Array.from(event.target.files)); event.target.value = ''; }} />
    {!file ? <div className="tool-panel repair-upload"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']}><Wrench size={32} /><div className="drop-zone-title">Choose a PDF to repair</div><div className="drop-zone-sub">Up to 256 MB · Processed on your device</div></DropZone></div> : <div className="repair-filebar"><FileText size={21} /><div><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)}{result ? ` · ${result.sourcePages} recognized pages` : ''}</span></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={busy} onClick={close} aria-label="Close PDF"><X size={17} /></button></div>}
    <div className={`repair-grid${!file ? ' before-upload' : ''}`}><aside className="tool-panel repair-settings"><fieldset disabled={busy}><legend>Repair method</legend><div className="repair-methods">
      <label className={mode === 'text' ? 'selected' : ''}><input type="radio" name="pdf-repair-method" value="text" checked={mode === 'text'} onChange={() => { clearResult(); setMode('text'); }} /><Type size={18} /><div><strong>Recover readable text</strong><span>Reflow selectable text with clean spacing and remove duplicate overlays. Changes layout; images, links and forms are not copied.</span></div></label>
      <label className={mode === 'structure' ? 'selected' : ''}><input type="radio" name="pdf-repair-method" value="structure" checked={mode === 'structure'} onChange={() => { clearResult(); setMode('structure'); }} /><Wrench size={18} /><div><strong>Repair structure</strong><span>Rewrite damaged PDF structure, retaining readable text, links and forms. Existing layout stays the same.</span></div></label>
      <label className={mode === 'rebuild' ? 'selected' : ''}><input type="radio" name="pdf-repair-method" value="rebuild" checked={mode === 'rebuild'} onChange={() => { clearResult(); setMode('rebuild'); }} /><Image size={18} /><div><strong>Rebuild pages</strong><span>Copy visible pages as static images. Existing overlap stays the same; unreadable pages are reported.</span></div></label>
    </div>{mode === 'rebuild' && <FormGroup label="Page quality"><select className="form-select" value={dpi} onChange={event => { clearResult(); setDpi(Number(event.target.value)); }}><option value={150}>Standard · 150 DPI</option><option value={200}>High · 200 DPI</option><option value={300}>Print · 300 DPI</option></select></FormGroup>}
      {mode === 'text' && <><FormGroup label="Reading order"><select className="form-select" value={textOrder} onChange={event => { clearResult(); setTextOrder(event.target.value); }}><option value="content">PDF drawing order · best for overlapping text</option><option value="position">Top to bottom · for scrambled drawing order</option></select></FormGroup><p className="repair-note">Selectable text only. Review the reading order; text inside images needs OCR.</p></>}
      {file && <button className="btn btn-primary repair-run" onClick={() => start(file)}><Wrench size={16} /> {result ? 'Run again' : mode === 'text' ? 'Recover readable text' : mode === 'rebuild' ? 'Rebuild PDF' : 'Repair PDF'}</button>}
    </fieldset><p className="repair-note">Missing data cannot be recreated. Repair is not a malware scan.</p></aside>
    {file && <section className="repair-result" aria-label="PDF repair result">
      {result ? <><div className="repair-result-heading"><div><h2>{result.mode === 'text' ? result.skippedPages.length ? 'Partial text recovery' : 'Text reflowed' : result.mode === 'structure' ? 'Structure rewritten' : result.skippedPages.length ? 'Partial recovery' : 'Pages rebuilt'}</h2><span>{result.outputPages} {result.outputPages === 1 ? 'page' : 'pages'} checked · {formatBytes(result.blob.size)}</span></div><button className="btn btn-primary" onClick={download}><Download size={16} /> {result.skippedPages.length ? `Download ${result.outputPages} recovered pages` : 'Download PDF'}</button></div>
        {result.mode !== 'text' && <div className="repair-layout-note"><span>Overlapping text is a layout problem. This method preserves its appearance.</span><button className="btn btn-secondary btn-sm" onClick={() => start(file, 'text')}>Recover readable text</button></div>}
        {result.mode === 'text' && <p className="repair-signature-note">Text from {result.recoveredPages.length} source pages laid out on {result.outputPages} new pages · {result.duplicateRuns} duplicate text runs removed. Images and interactive content are not included.</p>}
        {result.skippedPages.length > 0 && <div className="repair-partial" role="status"><strong>{result.recoveredPages.length} of {result.sourcePages} source pages recovered.</strong><span>Not included: {result.skippedPages.map(item => item.page).join(', ')}. Review the output before using it.</span></div>}
        {result.signatureCount > 0 && <p className="repair-signature-note">This PDF contains digital signatures. Rewriting changes the signed bytes; the repaired copy needs to be signed again.</p>}
        <WatermarkPdfPreview blob={result.blob} page={page} pageCount={result.outputPages} onPage={setPage} label="Repaired PDF" />
        {(result.mode === 'text' || result.skippedPages.length > 0) && <p className="repair-signature-note">Preview page {page} contains content from source page {result.pageSources?.[page - 1] ?? result.recoveredPages[page - 1]}.</p>}
        {result.skippedPages.length > 0 && <details className="repair-details"><summary>Recovery details</summary><ul>{result.skippedPages.map(item => <li key={item.page}><strong>Page {item.page}:</strong> {item.reason}</li>)}</ul></details>}
      </> : <div className="repair-empty"><Wrench size={30} /><strong>{busy ? status : error ? 'Repair could not finish' : status || 'Ready to repair'}</strong><span>{busy ? 'The resulting PDF will appear here.' : 'Choose a method and run repair.'}</span></div>}
    </section>}
    </div>
    {busy && <div className="repair-progress"><ProgressBar value={progress || null} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <div className="repair-error" role="alert"><span>{error}</span>{file && mode === 'structure' && !busy && !/password/i.test(error) && <button className="btn btn-secondary btn-sm" onClick={() => start(file, 'rebuild')}>Try Rebuild pages</button>}</div>}
    <div className="repair-samples"><strong>Sample PDFs</strong><a href="/samples/repair-overlapping-text.pdf" download>Overlapping text</a><a href="/samples/repair-clean-reference.pdf" download>Clean reference</a><a href="/samples/repair-damaged-structure.pdf" download>Damaged structure</a><span>Use Recover readable text for overlap; Repair structure for the damaged file.</span></div>
  </div></ToolPage>;
}
