import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { Download, FileText, Languages, Send, Trash2, Plus } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, FileItem, downloadBlob } from '../../components/ui';
import { readDocument, OCR_LANGUAGES, splitText } from '../../services/documentText';
import { callAi, TRANSLATION_LANGUAGES, REPLY_LANGUAGES, SUMMARY_LANGUAGES } from '../../services/aiClient';
import { answerDocument, summarizeDocument } from '../../services/documentAi';
import { richHtmlToPdf, sanitizeDocumentHtml } from '../../services/richPdf';
import { translatedLayoutPdf, translationRegions } from '../../services/translatedPdf';
import { extractInvoiceLocally, normalizeInvoice, INVOICE_FIELDS, ITEM_FIELDS, invoiceIssues, invoiceCsv } from '../../services/invoiceExtraction';
import './DocumentTools.css';

const markdownHtml = (text) => sanitizeDocumentHtml(marked.parse(text));
const basename = (file) => file?.name.replace(/\.[^.]+$/, '') || 'document';

function useDocument({ prepareOnUpload = false } = {}) {
  const [file, setFile] = useState(null), [pages, setPages] = useState([]);
  const [ocr, setOcr] = useState(true), [language, setLanguage] = useState('auto');
  const [forceOcr, setForceOcr] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false), [prepareAttempt, setPrepareAttempt] = useState(0);
  const [progress, setProgress] = useState(0), [progressLimit, setProgressLimit] = useState(0), [progressLabel, setProgressLabel] = useState('');
  const controller = useRef(null);
  const cachedOptions = useRef('');
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy && !preparing) return;
    const timer = setInterval(() => setProgress(previous => previous >= progressLimit ? previous : Math.min(progressLimit, previous + Math.max(.05, (progressLimit - previous) * .02))), 500);
    return () => clearInterval(timer);
  }, [busy, preparing, progressLimit]);
  useEffect(() => {
    if (!prepareOnUpload || !file) return;
    const current = new AbortController();
    const options = { ocr, forceOcr, language };
    setPreparing(true); setError(''); setStatus(''); setProgress(0); setProgressLimit(5); setProgressLabel('Preparing document');
    readDocument(file, { ...options, signal: current.signal, onStatus: setStatus, onProgress: value => {
      if (!current.signal.aborted) { setProgress(previous => Math.max(previous, Math.min(99, value))); setProgressLimit(Math.min(99, value)); }
    } }).then(source => {
      if (current.signal.aborted) return;
      cachedOptions.current = JSON.stringify(options);
      setPages(source); setProgress(100); setProgressLimit(100); setStatus('Ready to chat');
    }).catch(error => {
      if (!current.signal.aborted) { setError(error.message); setStatus(''); }
    }).finally(() => { if (!current.signal.aborted) setPreparing(false); });
    return () => current.abort();
  }, [prepareOnUpload, file, ocr, forceOcr, language, prepareAttempt]);
  const reportProgress = (value, limit = value, label) => {
    setProgress(previous => Math.max(previous, Math.min(99, value)));
    setProgressLimit(Math.min(99, limit));
    if (label) setProgressLabel(label);
  };
  const select = (files) => { if (busy || preparing) return; setFile(files[0] || null); setPages([]); setError(''); setStatus(''); setProgress(0); setProgressLimit(0); };
  const clearProgress = () => { setProgress(0); setProgressLimit(0); setError(''); setStatus(''); };
  const run = async (operation, readOptions = {}, operationLabel = 'Processing document') => {
    if (busy || preparing || !file) return;
    const options = { ocr, forceOcr, language, ...readOptions };
    const key = JSON.stringify(options);
    const cached = pages.length && cachedOptions.current === key;
    setBusy(true); setError(''); setStatus(''); setProgress(cached ? 20 : 0); setProgressLimit(cached ? 90 : 5); setProgressLabel(cached ? operationLabel : 'Reading document');
    const current = new AbortController(); controller.current = current;
    try {
      const source = cached ? pages : await readDocument(file, { ...options, onStatus: setStatus, onProgress: value => reportProgress(value * .2), signal: current.signal });
      if (current.signal.aborted) return;
      setPages(source);
      cachedOptions.current = key;
      reportProgress(20, 90, operationLabel);
      await operation(source, current.signal);
      if (!current.signal.aborted) { setStatus('Complete.'); setProgress(100); setProgressLimit(100); }
    } catch (error) { if (error.name !== 'AbortError') setError(error.message); setStatus(''); }
    finally { setBusy(false); }
  };
  return { file, pages, busy: busy || preparing, preparing, ready: Boolean(pages.length), retryPreparation: prepareOnUpload ? () => setPrepareAttempt(previous => previous + 1) : null, status, error, progress, progressLabel, reportProgress, clearProgress, select, run, setStatus, ocr, forceOcr, language, setOcr: (value) => { setOcr(value); setPages([]); clearProgress(); }, setForceOcr: (value) => { setForceOcr(value); setPages([]); clearProgress(); }, setLanguage: (value) => { setLanguage(value); setPages([]); clearProgress(); } };
}

function DocumentProgress({ doc }) {
  const percentage = Math.floor(doc.progress);
  return <div className={`document-progress ${doc.busy ? 'is-running' : 'is-complete'}`}>
    <div className="document-progress-heading"><span role="status">{doc.busy ? doc.progressLabel : 'Complete'}</span><strong>{percentage}%</strong></div>
    <div className="document-progress-track" role="progressbar" aria-label="Document progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}%${doc.busy ? ', estimated' : ', complete'}`}><div className="document-progress-fill" style={{ width: `${doc.progress}%` }} /></div>
    {doc.busy && <span className="document-progress-caption">Estimated progress</span>}
  </div>;
}

function SourceInput({ doc, images = false, automaticLanguage = false, showProgress = true, onSelect = () => {} }) {
  const readingIssues = doc.pages.filter(page => !page.blank && (page.readIssue || !page.text.trim() || (page.ocr && page.confidence < 65)));
  return <><fieldset disabled={doc.busy} className={`document-fieldset document-source ${doc.file ? 'has-file' : ''}`}><DropZone accept={images ? ['application/pdf', 'image/*'] : ['application/pdf']} onFiles={(files) => { if (!doc.busy && files.length) { doc.select(files); onSelect(); } }}><FileText size={22} /><div className="drop-zone-title">{doc.file ? 'Replace file' : images ? 'Choose a PDF or bill image' : 'Choose a PDF'}</div>{!doc.file && <p>Drop here or browse files</p>}</DropZone>
    {doc.file && <FileItem file={doc.file} onRemove={() => { if (!doc.busy) { doc.select([]); onSelect(); } }} />}
    <details className="document-settings"><summary>Scan settings <span>{doc.ocr ? automaticLanguage || doc.language === 'auto' ? 'Automatic' : Object.entries(OCR_LANGUAGES).find(([, code]) => code === doc.language)?.[0] : 'Scan reading off'}{doc.forceOcr && doc.ocr ? ' · Rescan on' : ''}</span></summary>
      <div className="document-options"><label className="document-check"><input type="checkbox" checked={doc.ocr} onChange={(event) => { doc.setOcr(event.target.checked); onSelect(); }} /> Read scanned pages</label>{!automaticLanguage && <label className="form-group">Scan language<select aria-label="Scan language" name="ocr-language" className="form-select" value={doc.language} onChange={(event) => { doc.setLanguage(event.target.value); onSelect(); }}>{Object.entries(OCR_LANGUAGES).map(([name, code]) => <option key={code} value={code}>{name}</option>)}</select></label>}</div>
      {doc.ocr && <label className="document-check"><input type="checkbox" checked={doc.forceOcr} onChange={(event) => { doc.setForceOcr(event.target.checked); onSelect(); }} /> Rescan every page <span className="document-muted">(slower)</span></label>}
      <p className="document-hint">{automaticLanguage ? 'Scan language follows the source language, or is detected automatically.' : 'Language is detected automatically. Choose a language only if a scan is read incorrectly.'}</p>
    </details>
  </fieldset>{!doc.busy && readingIssues.length > 0 && <details className="document-reading-notes"><summary>Reading details</summary><p>Small or image-only text may be incomplete on {readingIssues.length === 1 ? 'page' : 'pages'} {readingIssues.map(page => page.page).join(', ')}. Results use the readable content.</p></details>}{showProgress && (doc.busy || doc.progress === 100) && <DocumentProgress doc={doc} />}{doc.error && <div role="alert" className="document-error">{doc.error}{doc.retryPreparation && !doc.busy && <button type="button" className="btn btn-secondary" onClick={doc.retryPreparation}>Retry reading</button>}</div>}</>;
}

function AiNotice() { return <p className="document-notice">Text is processed by AI. Review AI results.</p>; }

function useBlobUrl(blob) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!blob) { setUrl(''); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}

function PdfPreview({ blob, title }) {
  const url = useBlobUrl(blob);
  return url ? <iframe className="document-pdf-preview" title={title} src={url} /> : null;
}

export function PdfTranslator() {
  const doc = useDocument();
  const [source, setSource] = useState('Auto-detect'), [target, setTarget] = useState('Hindi');
  const [result, setResult] = useState(null);
  const translate = () => doc.run(async (pages, signal) => {
    setResult(null);
    const units = [];
    const templates = pages.map((page) => {
      const regions = translationRegions(page.items || []);
      if (page.text.trim() && !regions.length) throw new Error(`Text positions could not be read on page ${page.page}. Try rescanning with OCR enabled.`);
      return { ...page, regions: regions.map((region, index) => {
        const ids = /\p{L}/u.test(region.text) ? splitText(region.text, 3500).map((text, part) => {
          const id = `${page.page}-${index}-${part}`; units.push({ id, text }); return id;
        }) : [];
        return { ...region, ids };
      }) };
    });
    const batches = []; let batch = [], size = 0;
    if (!units.length) throw new Error('No readable words were found to translate. Try a clearer document or enable scan reading.');
    for (const unit of units) { if (batch.length && (size + unit.text.length > 5500 || batch.length >= 60)) { batches.push(batch); batch = []; size = 0; } batch.push(unit); size += unit.text.length; }
    if (batch.length) batches.push(batch);
    const translations = new Map();
    for (let i = 0; i < batches.length; i++) {
      doc.reportProgress(20 + i / batches.length * 65, 20 + (i + 1) / batches.length * 65 - 1, 'Translating document');
      doc.setStatus(`Translating section ${i + 1} of ${batches.length}…`);
      const context = [batches[i - 1]?.map((block) => block.text).join('\n').slice(-2000), batches[i + 1]?.map((block) => block.text).join('\n').slice(0, 2000)].filter(Boolean).join('\n');
      const translated = await callAi('translate', { source, target, blocks: batches[i], ...(context ? { context } : {}) }, signal);
      translated.blocks.forEach((block) => translations.set(block.id, block.text));
      doc.reportProgress(20 + (i + 1) / batches.length * 65);
    }
    const translatedPages = templates.map(page => ({ ...page, regions: page.regions.map(region => ({ ...region, translated: region.ids.length ? region.ids.map(id => {
      if (!translations.has(id)) throw new Error('Some translated text is missing. Please retry translation.');
      return translations.get(id);
    }).join(' ') : region.text })) }));
    doc.reportProgress(85, 90, 'Preparing your PDF');
    const blob = await translatedLayoutPdf(doc.file, translatedPages, { title: `${basename(doc.file)} — ${target}`, signal, onStatus: doc.setStatus, onProgress: value => doc.reportProgress(85 + value * .13, 99) });
    setResult({ blob, target });
  }, { language: 'auto', sourceLanguage: source });
  return <ToolPage toolId="pdf-translator">
    <div className="tool-panel document-workspace">
      <SourceInput doc={doc} automaticLanguage onSelect={() => setResult(null)} />
      <fieldset disabled={doc.busy} className="document-fieldset document-toolbar">
        <label className="form-group">Source language<select aria-label="Source language" className="form-select" value={source} onChange={(event) => { setSource(event.target.value); setResult(null); doc.clearProgress(); }}>{['Auto-detect', ...TRANSLATION_LANGUAGES].map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="form-group">Translate into<select aria-label="Translate into" className="form-select" value={target} onChange={(event) => { setTarget(event.target.value); setResult(null); doc.clearProgress(); }}>{TRANSLATION_LANGUAGES.map(name => <option key={name}>{name}</option>)}</select></label>
        <button className="btn btn-primary document-cta" disabled={!doc.file || doc.busy} onClick={() => { setResult(null); translate(); }}><Languages size={18} />{doc.busy ? 'Translating…' : 'Translate entire PDF'}</button>
        {result && <button className="btn btn-primary document-cta" onClick={() => downloadBlob(result.blob, `${basename(doc.file)}-${result.target.toLowerCase()}-translated.pdf`)}><Download size={18} /> Download PDF</button>}
      </fieldset>
      <p className="document-notice">Original layout preserved. Longer labels use available space or wrap.</p>
      <AiNotice />
    </div>
    {result && <div className="tool-panel"><div className="document-actions"><h2>Translated document · {result.target}</h2></div><PdfPreview blob={result.blob} title="Translated PDF preview" /></div>}
  </ToolPage>;
}

export function ChatWithPdf() {
  const doc = useDocument({ prepareOnUpload: true });
  const [answerLanguage, setAnswerLanguage] = useState('Same as question');
  const [messages, setMessages] = useState([]), [question, setQuestion] = useState(''), [sourcePage, setSourcePage] = useState(1);
  const sourceUrl = useBlobUrl(doc.file);
  const displayedMessages = [];
  for (let index = messages.length - 2; index >= 0; index -= 2) {
    displayedMessages.push({ message: messages[index], index }, { message: messages[index + 1], index: index + 1 });
  }
  const ask = (event) => {
    event.preventDefault();
    const current = question.trim(); if (!current || !doc.ready) return;
    doc.run(async (pages, signal) => {
      doc.setStatus('Finding relevant pages and checking the answer…');
      const history = []; let historyBudget = 10000;
      for (const message of messages.slice(-10).reverse()) {
        if (!historyBudget) break;
        const content = message.content.slice(-Math.min(6000, historyBudget));
        history.unshift({ role: message.role, content }); historyBudget -= content.length;
      }
      const response = await answerDocument({ pages, question: current, history, language: answerLanguage, signal, onStatus: doc.setStatus });
      setMessages((previous) => [...previous, { role: 'user', content: current }, { role: 'assistant', content: response.answer, sources: response.sources }]);
      setQuestion('');
    }, {}, 'Finding answer');
  };
  return <ToolPage toolId="chat-with-pdf">
    <div className="tool-panel document-workspace">
      <SourceInput doc={doc} showProgress={doc.preparing} onSelect={() => { setMessages([]); setQuestion(''); setSourcePage(1); }} />
      {doc.ready && !doc.busy && <p className="document-notice" role="status">Ready to chat · PDF prepared</p>}
      <form onSubmit={ask} className="document-question">
        <label className="form-group">Your question<textarea name="document-question" className="form-textarea" rows={2} value={question} disabled={doc.busy && !doc.preparing} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder="What would you like to know about this PDF?" /></label>
        <div className="document-toolbar">
      <label className="form-group">Answer language
        <select aria-label="Answer language" className="form-select" name="answer-language" value={answerLanguage} disabled={doc.busy} onChange={(event) => setAnswerLanguage(event.target.value)}>{REPLY_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select>
      </label>
          <button className="btn btn-primary document-cta" disabled={!doc.ready || doc.busy || !question.trim()}><Send size={18} />{doc.preparing ? 'Preparing PDF…' : doc.busy ? 'Answering…' : 'Ask document'}</button>
          {doc.busy && !doc.preparing && <span role="status" className="document-notice">Finding answer…</span>}
          {messages.length > 0 && <button type="button" className="btn btn-secondary" disabled={doc.busy} onClick={() => setMessages([])}>Clear conversation</button>}
        </div>
      </form>
      <AiNotice />
      <div className="document-chat" aria-live="polite">
        {displayedMessages.map(({ message, index }) => <article key={index} className={`document-message ${message.role}`}>
          <strong>{message.role === 'user' ? 'You' : 'Document answer'}</strong>
          <div className="document-rich-preview" dangerouslySetInnerHTML={{ __html: markdownHtml(message.content) }} />
          {message.sources?.length > 0 && <div className="document-citations">{message.sources.map((source, j) => <button key={j} type="button" className="document-citation" onClick={() => setSourcePage(source.page)}><strong>Page {source.page}</strong><q>{source.quote}</q></button>)}</div>}
        </article>)}
      </div>
    </div>
    {sourceUrl && <div className="tool-panel"><h2>Source document · page {sourcePage}</h2><iframe key={`${sourceUrl}-${sourcePage}`} className="document-pdf-preview" title={`Source PDF page ${sourcePage}`} src={`${sourceUrl}#page=${sourcePage}`} /></div>}
  </ToolPage>;
}

export function PdfSummarizer() {
  const doc = useDocument();
  const [length, setLength] = useState('medium'), [format, setFormat] = useState('executive'), [result, setResult] = useState(null);
  const [summaryLanguage, setSummaryLanguage] = useState('Same as document');
  const summarize = () => doc.run(async (pages, signal) => {
    setResult(null);
    const text = await summarizeDocument({ pages, length, format, language: summaryLanguage, signal, onStatus: status => {
      doc.setStatus(status);
      const reviewing = status === 'Reviewing summary…';
      doc.reportProgress(reviewing ? 85 : 20, 95, reviewing ? 'Finishing summary' : 'Creating summary');
    } });
    doc.setStatus('Building summary PDF…');
    const html = markdownHtml(text);
    doc.reportProgress(97, 99, 'Preparing summary downloads');
    const blob = await richHtmlToPdf(html, { title: `${basename(doc.file)} summary`, footer: '{page} / {total}' });
    setResult({ text, html, blob });
  }, {}, 'Creating summary');
  return <ToolPage toolId="pdf-summarizer">
    <div className="tool-panel document-workspace"><SourceInput doc={doc} onSelect={() => setResult(null)} />
      <fieldset disabled={doc.busy} className="document-fieldset document-toolbar">
        <label className="form-group">Summary length<select className="form-select" value={length} onChange={(e) => setLength(e.target.value)}>{['short', 'medium', 'detailed'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="form-group">Summary format<select className="form-select" value={format} onChange={(e) => setFormat(e.target.value)}><option value="executive">Executive summary</option><option value="key-points">Key points</option><option value="study-notes">Study notes</option><option value="chapter-wise">Chapter-wise summary</option></select></label>
        <label className="form-group">Summary language<select aria-label="Summary language" name="summary-language" className="form-select" value={summaryLanguage} onChange={(event) => setSummaryLanguage(event.target.value)}>{SUMMARY_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></label>
        <button className="btn btn-primary document-cta" disabled={!doc.file || doc.busy} onClick={summarize}>{doc.busy ? 'Summarizing…' : 'Generate summary'}</button>
      </fieldset>
      <AiNotice />
    </div>
    {result && <div className="tool-panel"><div className="document-actions"><h2>Summary</h2><button className="btn btn-secondary" onClick={() => downloadBlob(new Blob([result.text], { type: 'text/plain;charset=utf-8' }), `${basename(doc.file)}-summary.txt`)}>Download TXT</button><button className="btn btn-primary" onClick={() => downloadBlob(result.blob, `${basename(doc.file)}-summary.pdf`)}>Download PDF</button></div><div className="document-rich-preview" dangerouslySetInnerHTML={{ __html: result.html }} /><PdfPreview blob={result.blob} title="Summary PDF preview" /></div>}
  </ToolPage>;
}

export function InvoiceExtractor() {
  const doc = useDocument();
  const [invoice, setInvoice] = useState(null), [raw, setRaw] = useState(''), [ai, setAi] = useState(false);
  const extract = () => doc.run(async (pages, signal) => {
    const text = pages.map((page) => page.text).join('\n\n'); setRaw(text);
    const local = extractInvoiceLocally(text); setInvoice(local);
    if (ai) {
      if (text.length > 24000) throw new Error('Local extraction is ready. AI extraction supports up to 24,000 characters per bill; split this document for AI extraction.');
      doc.setStatus('Extracting invoice fields with AI…');
      setInvoice(normalizeInvoice((await callAi('invoice', { text }, signal)).invoice));
    }
  });
  const update = (key, value) => setInvoice((previous) => ({ ...previous, [key]: ['supplierName', 'supplierAddress', 'invoiceNumber', 'invoiceDate', 'gstin', 'currency'].includes(key) ? value : value === '' ? null : Number(value) }));
  const issues = invoice ? invoiceIssues(invoice) : [];
  const exportName = `${basename(doc.file)}-extracted`;
  return <ToolPage toolId="invoice-extractor"><div className="tool-panel document-workspace"><SourceInput doc={doc} images onSelect={() => { setInvoice(null); setRaw(''); }} /><label className="document-check"><input type="checkbox" checked={ai} disabled={doc.busy} onChange={(e) => setAi(e.target.checked)} /> Use AI for complex bills</label><p className="document-hint">Review extracted amounts before exporting.</p><button className="btn btn-primary document-cta" disabled={!doc.file || doc.busy} onClick={extract}>{doc.busy ? 'Extracting…' : 'Extract bill details'}</button></div>{invoice && <div className="tool-panel"><div className="document-actions"><h2>Review extracted details</h2><button className="btn btn-secondary" onClick={() => downloadBlob(new Blob([invoiceCsv(invoice)], { type: 'text/csv;charset=utf-8' }), `${exportName}.csv`)}>Export CSV</button><button className="btn btn-secondary" onClick={() => downloadBlob(new Blob([JSON.stringify({ ...invoice, warnings: issues }, null, 2)], { type: 'application/json' }), `${exportName}.json`)}>Export JSON</button></div>{issues.length > 0 ? <div className="document-warnings" role="status"><strong>Check these values</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : <p className="document-status">Required fields are present and arithmetic checks pass. Verify against the original bill.</p>}<div className="document-field-grid">{Object.entries(INVOICE_FIELDS).map(([key, label]) => <label className="form-group" key={key}>{label}<input className="form-input" type={['supplierName', 'supplierAddress', 'invoiceNumber', 'invoiceDate', 'gstin', 'currency'].includes(key) ? 'text' : 'number'} step="any" value={invoice[key] ?? ''} aria-invalid={['supplierName', 'invoiceNumber', 'invoiceDate', 'gstin', 'subtotal', 'grandTotal'].includes(key) && (invoice[key] === '' || invoice[key] == null)} onChange={(e) => update(key, e.target.value)} /></label>)}</div><div className="document-table-scroll"><table className="document-table"><thead><tr>{ITEM_FIELDS.map((key) => <th key={key}>{key}</th>)}<th>Remove</th></tr></thead><tbody>{invoice.items.map((item, index) => <tr key={index}>{ITEM_FIELDS.map((key) => <td key={key}><input className="form-input" aria-label={`Item ${index + 1} ${key}`} type={key === 'description' ? 'text' : 'number'} step="any" value={item[key] ?? ''} onChange={(e) => setInvoice((previous) => ({ ...previous, items: previous.items.map((entry, i) => i !== index ? entry : { ...entry, [key]: key === 'description' ? e.target.value : e.target.value === '' ? null : Number(e.target.value) }) }))} /></td>)}<td><button className="icon-btn" aria-label={`Remove item ${index + 1}`} onClick={() => setInvoice((previous) => ({ ...previous, items: previous.items.filter((_, i) => i !== index) }))}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div><button className="btn btn-secondary" onClick={() => setInvoice((previous) => ({ ...previous, items: [...previous.items, { description: '', quantity: null, price: null, discount: null, amount: null }] }))}><Plus size={16} /> Add line item</button><details className="document-raw"><summary>View extracted source text</summary><pre>{raw}</pre></details></div>}</ToolPage>;
}
