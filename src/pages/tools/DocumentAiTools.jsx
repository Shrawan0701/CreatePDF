import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { Download, FileText, Send, Trash2, Plus } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, FileItem, downloadBlob } from '../../components/ui';
import { readDocument, OCR_LANGUAGES, splitText } from '../../services/documentText';
import { callAi, TRANSLATION_LANGUAGES, REPLY_LANGUAGES, SUMMARY_LANGUAGES } from '../../services/aiClient';
import { answerDocument, summarizeDocument } from '../../services/documentAi';
import { richHtmlToPdf, sanitizeDocumentHtml } from '../../services/richPdf';
import { extractInvoiceLocally, normalizeInvoice, INVOICE_FIELDS, ITEM_FIELDS, invoiceIssues, invoiceCsv } from '../../services/invoiceExtraction';
import './DocumentTools.css';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const markdownHtml = (text) => sanitizeDocumentHtml(marked.parse(text));
const basename = (file) => file?.name.replace(/\.[^.]+$/, '') || 'document';

function useDocument() {
  const [file, setFile] = useState(null), [pages, setPages] = useState([]);
  const [ocr, setOcr] = useState(true), [language, setLanguage] = useState('eng');
  const [forceOcr, setForceOcr] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const select = (files) => { if (busy) return; setFile(files[0]); setPages([]); setError(''); setStatus(''); };
  const run = async (operation) => {
    if (busy || !file) return;
    setBusy(true); setError('');
    const current = new AbortController(); controller.current = current;
    try {
      const source = pages.length ? pages : await readDocument(file, { ocr, forceOcr, language, onStatus: setStatus, signal: current.signal });
      if (current.signal.aborted) return;
      setPages(source);
      await operation(source, current.signal);
      if (!current.signal.aborted) setStatus('Complete.');
    } catch (error) { if (error.name !== 'AbortError') setError(error.message); setStatus(''); }
    finally { setBusy(false); }
  };
  return { file, pages, busy, status, error, select, run, setStatus, ocr, forceOcr, language, setOcr: (value) => { setOcr(value); setPages([]); }, setForceOcr: (value) => { setForceOcr(value); setPages([]); }, setLanguage: (value) => { setLanguage(value); setPages([]); } };
}

function SourceInput({ doc, images = false, onSelect = () => {} }) {
  return <><fieldset disabled={doc.busy} className="document-fieldset"><DropZone accept={images ? ['application/pdf', 'image/*'] : ['application/pdf']} onFiles={(files) => { if (!doc.busy && files.length) { doc.select(files); onSelect(); } }}><FileText size={30} /><div className="drop-zone-title">{images ? 'Choose a PDF invoice or bill image' : 'Choose a PDF document'}</div><p>Drop a file here or click to browse</p></DropZone>
    {doc.file && <FileItem file={doc.file} />}
    <div className="document-options"><label className="document-check"><input type="checkbox" checked={doc.ocr} onChange={(event) => doc.setOcr(event.target.checked)} /> Use OCR for scanned pages</label><label className="form-group">OCR language<select aria-label="OCR language" name="ocr-language" className="form-select" value={doc.language} onChange={(event) => doc.setLanguage(event.target.value)}>{Object.entries(OCR_LANGUAGES).map(([name, code]) => <option key={code} value={code}>{name}</option>)}</select></label></div>
    {doc.ocr && <label className="document-check"><input type="checkbox" checked={doc.forceOcr} onChange={(event) => doc.setForceOcr(event.target.checked)} /> Rescan every page (for missing or incorrect text; slower)</label>}
    <p className="document-hint">Choose the language printed in your scan, which can differ from your answer or translation language. Choose a combined option for English mixed with another language. OCR runs on your device and downloads language data on first use.</p>
    {doc.pages.some((page) => !page.text.trim() || (page.ocr && page.confidence < 65)) && <p className="document-warnings" role="status">Some pages have missing text or low-confidence OCR: {doc.pages.filter((page) => !page.text.trim() || (page.ocr && page.confidence < 65)).map((page) => page.page).join(', ')}. Check the scan and OCR language. AI cannot reliably recover unreadable text.</p>}
  </fieldset>{doc.busy && <p role="status" className="document-status">{doc.status || 'Processing…'}</p>}{doc.error && <p role="alert" className="document-error">{doc.error}</p>}</>;
}

function AiNotice() { return <p className="document-hint">This tool sends extracted document text to OpenAI for processing. Your original PDF stays in this browser. AI output can contain mistakes; review it before use.</p>; }

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
    const templates = pages.map((page) => ({ ...page, blocks: page.blocks.map((block, b) => {
      const add = (text, suffix) => { const ids = splitText(text, 3500).map((part, i) => { const id = `${page.page}-${b}-${suffix}-${i}`; units.push({ id, text: part }); return id; }); return ids; };
      return block.type === 'table' ? { ...block, cells: block.rows.map((row, r) => row.map((cell, c) => add(cell, `${r}-${c}`))) } : { ...block, ids: add(block.text, 'text') };
    }) }));
    const batches = []; let batch = [], size = 0;
    for (const unit of units) { if (batch.length && (size + unit.text.length > 5500 || batch.length >= 60)) { batches.push(batch); batch = []; size = 0; } batch.push(unit); size += unit.text.length; }
    if (batch.length) batches.push(batch);
    const translations = new Map();
    for (let i = 0; i < batches.length; i++) {
      doc.setStatus(`Translating section ${i + 1} of ${batches.length}…`);
      const context = [batches[i - 1]?.map((block) => block.text).join('\n').slice(-2000), batches[i + 1]?.map((block) => block.text).join('\n').slice(0, 2000)].filter(Boolean).join('\n');
      const translated = await callAi('translate', { source, target, blocks: batches[i], ...(context ? { context } : {}) }, signal);
      translated.blocks.forEach((block) => translations.set(block.id, block.text));
    }
    const join = (ids) => ids.map((id) => translations.get(id)).join(' ');
    const html = templates.map((page) => `<section data-page-break="before">${page.blocks.map((block) => {
      if (block.type === 'table') return `<table>${block.cells.map((row) => `<tr>${row.map((ids) => `<td>${escape(join(ids))}</td>`).join('')}</tr>`).join('')}</table>`;
      const text = escape(join(block.ids)).replaceAll('\n', '<br>');
      return block.type === 'heading' ? `<h2>${text}</h2>` : block.type === 'list' ? `<ul><li>${text.replace(/^(?:[•●▪*-]|\d+[.)])\s*/, '')}</li></ul>` : `<p>${text}</p>`;
    }).join('')}</section>`).join('');
    doc.setStatus('Building translated PDF…');
    const blob = await richHtmlToPdf(html, { title: `${basename(doc.file)} — ${target}`, footer: '{page} / {total}' });
    setResult({ html: sanitizeDocumentHtml(html), blob });
  });
  return <ToolPage toolId="pdf-translator"><div className="tool-panel"><SourceInput doc={doc} onSelect={() => setResult(null)} /><AiNotice /><fieldset disabled={doc.busy} className="document-fieldset document-options"><label className="form-group">Source language<select className="form-select" value={source} onChange={(e) => setSource(e.target.value)}>{['Auto-detect', ...TRANSLATION_LANGUAGES].map((name) => <option key={name}>{name}</option>)}</select></label><label className="form-group">Translate into<select className="form-select" value={target} onChange={(e) => setTarget(e.target.value)}>{TRANSLATION_LANGUAGES.map((name) => <option key={name}>{name}</option>)}</select></label></fieldset><p className="document-hint">Headings, paragraphs, lists and detected table cells are reconstructed. Layout, artwork and page count may change. OCR cannot always recover table structure.</p><button className="btn btn-primary" disabled={!doc.file || doc.busy} onClick={translate}>{doc.busy ? 'Translating…' : 'Translate entire PDF'}</button></div>{result && <div className="tool-panel"><div className="document-actions"><h2>Translated document</h2><button className="btn btn-primary" onClick={() => downloadBlob(result.blob, `${basename(doc.file)}-translated.pdf`)}><Download size={16} /> Download PDF</button></div><div className="document-rich-preview" dangerouslySetInnerHTML={{ __html: result.html }} /><PdfPreview blob={result.blob} title="Translated PDF preview" /></div>}</ToolPage>;
}

export function ChatWithPdf() {
  const doc = useDocument();
  const [answerLanguage, setAnswerLanguage] = useState('Same as question');
  const [messages, setMessages] = useState([]), [question, setQuestion] = useState(''), [sourcePage, setSourcePage] = useState(1);
  const sourceUrl = useBlobUrl(doc.file);
  const ask = (event) => {
    event.preventDefault();
    const current = question.trim(); if (!current) return;
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
    });
  };
  return <ToolPage toolId="chat-with-pdf">
    <div className="tool-panel">
      <SourceInput doc={doc} onSelect={() => { setMessages([]); setSourcePage(1); }} /><AiNotice />
      <label className="form-group">Answer language
        <select aria-label="Answer language" className="form-select" name="answer-language" value={answerLanguage} disabled={doc.busy} onChange={(event) => setAnswerLanguage(event.target.value)}>{REPLY_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select>
      </label>
      <p className="document-hint">Ask in any supported language, even when your PDF uses a different one. Short PDFs are read in full; longer PDFs are scanned by AI for relevant evidence. Source quotes stay in the document’s original language.</p>
      <div className="document-chat" aria-live="polite">
        {!messages.length && <p className="document-hint">Ask about a topic, figure, or named page. Follow-up questions keep the current conversation context.</p>}
        {messages.map((message, i) => <article key={i} className={`document-message ${message.role}`}>
          <strong>{message.role === 'user' ? 'You' : 'Document answer'}</strong>
          <div className="document-rich-preview" dangerouslySetInnerHTML={{ __html: markdownHtml(message.content) }} />
          {message.sources?.length > 0 && <div className="document-citations">{message.sources.map((source, j) => <button key={j} type="button" className="document-citation" onClick={() => setSourcePage(source.page)}><strong>Page {source.page}</strong><q>{source.quote}</q></button>)}</div>}
        </article>)}
      </div>
      <form onSubmit={ask} className="document-question">
        <label className="form-group">Your question<textarea name="document-question" className="form-textarea" value={question} disabled={doc.busy} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask in English, Hindi, Marathi, Spanish, French, German, Portuguese or Italian…" /></label>
        <button className="btn btn-primary" disabled={!doc.file || doc.busy || !question.trim()}><Send size={16} /> Ask document</button>
        {messages.length > 0 && <button type="button" className="btn btn-secondary" disabled={doc.busy} onClick={() => setMessages([])}>Clear conversation</button>}
      </form>
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
    const text = await summarizeDocument({ pages, length, format, language: summaryLanguage, signal, onStatus: doc.setStatus });
    doc.setStatus('Building summary PDF…');
    const html = markdownHtml(text);
    const blob = await richHtmlToPdf(html, { title: `${basename(doc.file)} summary`, footer: '{page} / {total}' });
    setResult({ text, html, blob });
  });
  return <ToolPage toolId="pdf-summarizer">
    <div className="tool-panel"><SourceInput doc={doc} onSelect={() => setResult(null)} /><AiNotice />
      <fieldset disabled={doc.busy} className="document-fieldset document-options">
        <label className="form-group">Summary length<select className="form-select" value={length} onChange={(e) => setLength(e.target.value)}>{['short', 'medium', 'detailed'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="form-group">Summary format<select className="form-select" value={format} onChange={(e) => setFormat(e.target.value)}><option value="executive">Executive summary</option><option value="key-points">Key points</option><option value="study-notes">Study notes</option><option value="chapter-wise">Chapter-wise summary</option></select></label>
        <label className="form-group">Summary language<select aria-label="Summary language" name="summary-language" className="form-select" value={summaryLanguage} onChange={(event) => setSummaryLanguage(event.target.value)}>{SUMMARY_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></label>
      </fieldset>
      <p className="document-hint">AI reads every section, combines the findings, then reviews the summary for source accuracy and missing details. Language selection also applies to TXT and PDF downloads.</p>
      <button className="btn btn-primary" disabled={!doc.file || doc.busy} onClick={summarize}>{doc.busy ? 'Summarizing…' : 'Generate summary'}</button>
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
      doc.setStatus('Extracting invoice fields with OpenAI…');
      setInvoice(normalizeInvoice((await callAi('invoice', { text }, signal)).invoice));
    }
  });
  const update = (key, value) => setInvoice((previous) => ({ ...previous, [key]: ['supplierName', 'supplierAddress', 'invoiceNumber', 'invoiceDate', 'gstin', 'currency'].includes(key) ? value : value === '' ? null : Number(value) }));
  const issues = invoice ? invoiceIssues(invoice) : [];
  const exportName = `${basename(doc.file)}-extracted`;
  return <ToolPage toolId="invoice-extractor"><div className="tool-panel"><SourceInput doc={doc} images onSelect={() => { setInvoice(null); setRaw(''); }} /><label className="document-check"><input type="checkbox" checked={ai} disabled={doc.busy} onChange={(e) => setAi(e.target.checked)} /> Use OpenAI for complex bills (sends extracted text)</label><p className="document-hint">Local extraction runs first. Upload one invoice at a time. Check extracted values against the original; blank fields mean unknown. Discounts are currency amounts, not percentages.</p><button className="btn btn-primary" disabled={!doc.file || doc.busy} onClick={extract}>{doc.busy ? 'Extracting…' : 'Extract bill details'}</button></div>{invoice && <div className="tool-panel"><div className="document-actions"><h2>Review extracted details</h2><button className="btn btn-secondary" onClick={() => downloadBlob(new Blob([invoiceCsv(invoice)], { type: 'text/csv;charset=utf-8' }), `${exportName}.csv`)}>Export CSV</button><button className="btn btn-secondary" onClick={() => downloadBlob(new Blob([JSON.stringify({ ...invoice, warnings: issues }, null, 2)], { type: 'application/json' }), `${exportName}.json`)}>Export JSON</button></div>{issues.length > 0 ? <div className="document-warnings" role="status"><strong>Check these values</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : <p className="document-status">Required fields are present and arithmetic checks pass. Verify against the original bill.</p>}<div className="document-field-grid">{Object.entries(INVOICE_FIELDS).map(([key, label]) => <label className="form-group" key={key}>{label}<input className="form-input" type={['supplierName', 'supplierAddress', 'invoiceNumber', 'invoiceDate', 'gstin', 'currency'].includes(key) ? 'text' : 'number'} step="any" value={invoice[key] ?? ''} aria-invalid={['supplierName', 'invoiceNumber', 'invoiceDate', 'gstin', 'subtotal', 'grandTotal'].includes(key) && (invoice[key] === '' || invoice[key] == null)} onChange={(e) => update(key, e.target.value)} /></label>)}</div><div className="document-table-scroll"><table className="document-table"><thead><tr>{ITEM_FIELDS.map((key) => <th key={key}>{key}</th>)}<th>Remove</th></tr></thead><tbody>{invoice.items.map((item, index) => <tr key={index}>{ITEM_FIELDS.map((key) => <td key={key}><input className="form-input" aria-label={`Item ${index + 1} ${key}`} type={key === 'description' ? 'text' : 'number'} step="any" value={item[key] ?? ''} onChange={(e) => setInvoice((previous) => ({ ...previous, items: previous.items.map((entry, i) => i !== index ? entry : { ...entry, [key]: key === 'description' ? e.target.value : e.target.value === '' ? null : Number(e.target.value) }) }))} /></td>)}<td><button className="icon-btn" aria-label={`Remove item ${index + 1}`} onClick={() => setInvoice((previous) => ({ ...previous, items: previous.items.filter((_, i) => i !== index) }))}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div><button className="btn btn-secondary" onClick={() => setInvoice((previous) => ({ ...previous, items: [...previous.items, { description: '', quantity: null, price: null, discount: null, amount: null }] }))}><Plus size={16} /> Add line item</button><details className="document-raw"><summary>View extracted source text</summary><pre>{raw}</pre></details></div>}</ToolPage>;
}
