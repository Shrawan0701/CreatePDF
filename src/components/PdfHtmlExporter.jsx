import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Code2, Copy, Download, Eye, FileCode2, Globe, Link2, LoaderCircle, Monitor, ShieldCheck, Smartphone, Upload } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { pdfToHtml } from '../services/pdfToHtml'
import './PdfHtmlExporter.css'

const defaults = { layout: 'appearance', pageRange: '', title: '', scale: 2, packageAssets: false, selectableText: true, includeLinks: true, includeImages: true, password: '' }

export function PdfHtmlExporter() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [options, setOptions] = useState(defaults)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Preparing PDF')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('preview')
  const [device, setDevice] = useState('desktop')
  const [copied, setCopied] = useState(false)
  const operation = useRef(null)
  useEffect(() => () => { operation.current?.abort(); operation.current = null }, [])
  const change = (key, value) => {
    setOptions(current => ({ ...current, [key]: value })); setResult(null); setError(''); setCopied(false)
  }
  const choose = source => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setResult(null); setError(''); setProgress(0); setTab('preview'); setCopied(false)
    if (source && !/\.pdf$/i.test(source.name) && source.type !== 'application/pdf') { setFile(null); setError('Choose a PDF file to convert.'); return }
    setFile(source || null)
    setOptions(current => ({ ...current, pageRange: '', password: '', title: source?.name.replace(/\.pdf$/i, '') || '' }))
  }
  const run = async (save = false) => {
    if (!file || busy) return
    if (result && save) { downloadBlob(result.blob, `${file.name.replace(/\.pdf$/i, '')}.${result.extension}`); return }
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing PDF'); setResult(null)
    try {
      const converted = await pdfToHtml(file, { ...options, signal: controller.signal }, (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label) }
      })
      if (controller.signal.aborted || operation.current !== controller) return
      setResult(converted); setTab('preview')
      if (save) downloadBlob(converted.blob, `${file.name.replace(/\.pdf$/i, '')}.${converted.extension}`)
      showToast('HTML ready. Review the preview or download your file.', 'success')
    } catch (error) {
      if (operation.current === controller && !controller.signal.aborted) setError(error.message || 'Could not convert this PDF. Try again.')
    } finally { if (operation.current === controller) { setBusy(false); operation.current = null } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const copy = async () => {
    if (!result) return
    try { await navigator.clipboard.writeText(result.html); setCopied(true); showToast('Complete HTML copied.', 'success') } catch { setError('Clipboard access is unavailable. Download the HTML file instead.') }
  }
  // Keep large embedded images out of the on-screen code listing; copied/downloaded source stays complete.
  const sourcePreview = useMemo(() => result?.html.replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, '[embedded image data]').replace(/></g, '>\n<') || '', [result])

  return <ToolPage toolId="pdf-to-html"><div className="html-exporter">
    <div className="html-export-proof"><span><ShieldCheck size={15} /> Converted on your device</span><span><Globe size={15} /> Works offline after export</span><span><Link2 size={15} /> Keep supported links</span></div>
    <div className="html-export-layout">
      <section className="tool-panel html-export-settings" aria-labelledby="html-export-settings-title">
        <div className="html-export-heading"><span className="html-export-step">01</span><div><h2 id="html-export-settings-title">From PDF to the web</h2><p>Choose how your document should read.</p></div></div>
        <DropZone accept={['application/pdf', '.pdf']} onFiles={([source]) => { if (source) choose(source) }} className="html-export-drop"><span className="html-export-upload"><Upload size={24} /></span><div className="drop-zone-title">{file ? 'Choose another PDF' : 'Drop your PDF here'}</div><div className="drop-zone-sub">or click to browse your files</div><span className="html-export-file-type">PDF document</span></DropZone>
        {file && <FileItem file={file} onRemove={() => choose(null)} />}
        <fieldset className="html-export-modes" disabled={busy}><legend>HTML layout</legend><label className={options.layout === 'appearance' ? 'is-active' : ''}><input type="radio" name="html-layout" value="appearance" checked={options.layout === 'appearance'} onChange={() => change('layout', 'appearance')} /><Monitor size={19} /><span><strong>Keep page appearance</strong><small>Original design with selectable text.</small></span>{options.layout === 'appearance' && <Check size={15} />}</label><label className={options.layout === 'reading' ? 'is-active' : ''}><input type="radio" name="html-layout" value="reading" checked={options.layout === 'reading'} onChange={() => change('layout', 'reading')} /><FileCode2 size={19} /><span><strong>Responsive reading layout</strong><small>Real HTML text that adapts to the screen.</small></span>{options.layout === 'reading' && <Check size={15} />}</label></fieldset>
        <p className="html-export-mode-note">{options.layout === 'appearance' ? 'Keeps the page as an image, with aligned text and link layers. Best for resumes, forms, and complex designs.' : 'Rebuilds readable headings, paragraphs, lists, and detected tables. Embedded images follow the text; complex columns and spacing may differ.'}</p>
        <div className="html-export-fields"><FormGroup label="Pages" hint="Leave blank for all pages, or enter 1-3, 5."><input className="form-input" disabled={busy} value={options.pageRange} placeholder="All pages" onChange={event => change('pageRange', event.target.value)} /></FormGroup><FormGroup label="HTML document title"><input className="form-input" disabled={busy} value={options.title} placeholder="Document title" onChange={event => change('title', event.target.value)} /></FormGroup><FormGroup label="Image resolution"><select className="form-select" disabled={busy} value={options.scale} onChange={event => change('scale', Number(event.target.value))}><option value="1">Standard · 72 DPI</option><option value="1.5">Balanced · 108 DPI</option><option value="2">High · 144 DPI</option><option value="3">Maximum · 216 DPI</option></select></FormGroup></div>
        <div className="html-export-options">{options.layout === 'appearance' ? <label className="check-row"><input type="checkbox" disabled={busy} checked={options.selectableText} onChange={event => change('selectableText', event.target.checked)} />Include selectable text</label> : <label className="check-row"><input type="checkbox" disabled={busy} checked={options.includeImages} onChange={event => change('includeImages', event.target.checked)} />Include embedded images</label>}<label className="check-row"><input type="checkbox" disabled={busy} checked={options.includeLinks} onChange={event => change('includeLinks', event.target.checked)} />Keep clickable links</label><label className="check-row"><input type="checkbox" disabled={busy} checked={options.packageAssets} onChange={event => change('packageAssets', event.target.checked)} />Package HTML and page images in a ZIP</label><p>{options.packageAssets ? 'Includes index.html and an assets folder. Extract the ZIP before opening or hosting.' : 'One self-contained HTML file with embedded images. Open it directly in your browser.'}</p></div>
        <details className="html-export-password"><summary>Password-protected PDF?</summary><FormGroup label="PDF opening password"><input type="password" className="form-input" autoComplete="off" disabled={busy} value={options.password} onChange={event => change('password', event.target.value)} /></FormGroup></details>
        {error && <p className="html-export-error" role="alert">{error}</p>}
        {busy && <div className="html-export-progress" role="status"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel conversion</button></div>}
        <div className="html-export-actions"><button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={() => run(false)}>{busy ? <LoaderCircle size={17} className="html-export-spin" /> : <Eye size={17} />}{busy ? 'Converting…' : result ? 'Regenerate preview' : 'Convert & preview'}{!busy && <ArrowRight size={16} />}</button><button className="btn btn-secondary" disabled={!file || busy} onClick={() => run(true)}><Download size={16} />{options.packageAssets ? 'Download ZIP' : 'Download HTML'}</button></div>
        <p className="html-export-local"><ShieldCheck size={13} /> Your document stays in this browser.</p>
      </section>

      <section className="html-export-output" aria-label="Conversion preview" aria-busy={busy}>
        {result ? <div className="tool-panel html-export-result"><div className="html-export-heading"><span className="html-export-step">02</span><div><h2>Your HTML is ready</h2><p>{result.pages} {result.pages === 1 ? 'page' : 'pages'} · {result.links} {result.links === 1 ? 'link' : 'links'} · {formatBytes(result.blob.size)}</p></div><span className="html-export-ready"><Check size={13} />Ready</span></div>
          <div className="html-export-preview-toolbar"><div className="html-export-tabs" role="tablist" aria-label="Output view"><button role="tab" id="html-preview-tab" aria-controls="html-result-panel" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}><Eye size={14} />Preview</button><button role="tab" id="html-source-tab" aria-controls="html-result-panel" aria-selected={tab === 'source'} onClick={() => setTab('source')}><Code2 size={14} />HTML source</button></div>{tab === 'preview' ? <div className="html-export-device"><button className="icon-btn" aria-label="Desktop preview" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor size={16} /></button><button className="icon-btn" aria-label="Mobile preview" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone size={16} /></button></div> : <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy HTML'}</button>}</div>
          <div id="html-result-panel" role="tabpanel" aria-labelledby={tab === 'preview' ? 'html-preview-tab' : 'html-source-tab'} className={`html-export-preview-body ${device === 'mobile' ? 'is-mobile' : ''}`}>{tab === 'preview' ? <iframe title="Converted HTML preview" sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox" srcDoc={result.previewHtml} /> : <div className="html-export-code"><p>Embedded image data is shortened here. Copy HTML and downloads include the complete source{options.packageAssets ? '; keep the assets folder beside index.html' : ''}.</p><pre tabIndex={0}><code>{sourcePreview}</code></pre></div>}</div>
          <div className="html-export-result-foot"><span><Check size={14} />Preview matches the exported HTML</span><button className="btn btn-primary btn-sm" onClick={() => run(true)}><Download size={14} />{options.packageAssets ? 'Save ZIP' : 'Save HTML'}</button></div>
          {result.scannedPages > 0 && <div className="html-export-notice" role="status">{result.scannedPages} {result.scannedPages === 1 ? 'page has' : 'pages have'} no selectable text and {result.scannedPages === 1 ? 'is' : 'are'} preserved as images. OCR is needed to turn scans into text.</div>}
          {result.warnings.length > 0 && <details className="html-export-notice"><summary>Conversion notes ({result.warnings.length})</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        </div> : file ? <DocumentPdfPreview key={file.name + file.lastModified} blob={file} heading="Source PDF" emptyLabel="Choose a PDF to preview" readyLabel={busy ? 'Converting your document…' : 'Convert to preview your HTML'} /> : <div className="tool-panel html-export-empty"><div className="html-export-heading"><span className="html-export-step">02</span><div><h2>See it before you save it</h2><p>Your document, ready for the browser.</p></div></div><div className="html-export-empty-body"><div className="html-export-browser-art" aria-hidden="true"><div><i /><i /><i /><span>your-document.html</span></div><Code2 size={45} strokeWidth={1.25} /><b /><b /><b /></div><h3>A PDF. A web page. Your choice.</h3><p>Keep the original page design or create a reading layout. Preview your HTML on desktop and mobile, then save it in one click.</p><span className="html-export-empty-tag"><Globe size={13} /> No hosting needed to open your HTML</span></div></div>}
      </section>
    </div>
  </div></ToolPage>
}
