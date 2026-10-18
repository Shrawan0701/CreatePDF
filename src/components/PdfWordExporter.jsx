import { useState } from 'react'
import { Download, FileOutput } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { pdfToWord } from '../services/pdfToWord'

export function PdfWordExporter() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [filename, setFilename] = useState('document')
  const [options, setOptions] = useState({ mode: 'editable', pageRange: '', detectTables: true, includeImages: true })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const change = (key, value) => { setOptions(current => ({ ...current, [key]: value })); setResult(null); setError('') }
  const choose = source => {
    if (busy) return
    setFile(source); setFilename(source?.name.replace(/\.pdf$/i, '') || 'document'); setResult(null); setError(''); setProgress(0)
  }
  const run = async () => {
    if (!file || busy) return
    setBusy(true); setError(''); setProgress(0)
    try {
      const converted = result || await pdfToWord(file, options, setProgress)
      setResult(converted)
      downloadBlob(converted.blob, `${filename.trim().replace(/\.docx$/i, '') || 'document'}.docx`)
      showToast('Word document created locally.', 'success')
    } catch (error) { setError(error.message); showToast(error.message, 'error') } finally { setBusy(false) }
  }
  return <ToolPage toolId="pdf-to-word"><div className="composer-layout word-export-layout"><div className="tool-panel">
    <h2 className="tool-panel-title">Convert your PDF to Word</h2>
    <DropZone accept={['application/pdf', '.pdf']} onFiles={([source]) => choose(source)}><FileOutput size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Retain page sizes, editable text, tables, divider lines, drawings, and images.</div></DropZone>
    {file && <FileItem file={file} onRemove={busy ? undefined : () => choose(null)} />}
    <FormGroup label="Conversion mode"><select className="form-select" disabled={busy} value={options.mode} onChange={event => change('mode', event.target.value)}><option value="editable">Editable text & layout</option><option value="appearance">Keep page appearance (page images)</option></select></FormGroup>
    <p className="form-hint">{options.mode === 'editable' ? 'Keeps divider lines, underlines, stamps, and drawn signatures alongside editable text and tables. Complex layouts and fonts can vary in Word. Scanned pages are included as images; use OCR for editable scan text.' : 'Includes each PDF page as a high-resolution image in Word. This preserves its appearance; the page text is not editable.'}</p>
    <div className="form-grid"><FormGroup label="Pages" hint="Leave blank for all pages. Example: 1-3, 5"><input className="form-input" disabled={busy} value={options.pageRange} onChange={event => change('pageRange', event.target.value)} placeholder="All pages" /></FormGroup><FormGroup label="Word filename"><input className="form-input" disabled={busy} value={filename} onChange={event => setFilename(event.target.value)} /></FormGroup></div>
    {options.mode === 'editable' && <div className="word-export-options"><label className="check-row"><input type="checkbox" disabled={busy} checked={options.detectTables} onChange={event => change('detectTables', event.target.checked)} />Reconstruct editable tables</label><label className="check-row"><input type="checkbox" disabled={busy} checked={options.includeImages} onChange={event => change('includeImages', event.target.checked)} />Include images and signatures</label></div>}
    {error && <p className="pdf-preview-error" role="alert">{error}</p>}
    {busy && <ProgressBar value={progress} label="Reconstructing Word document" />}
    <button className="btn btn-primary btn-lg create-download" disabled={!file || busy} onClick={run}><Download size={17} />{busy ? 'Converting…' : 'Download DOCX'}</button>
    {result && <div className="word-export-result" role="status"><strong>Word document ready</strong><p>{result.pages} {result.pages === 1 ? 'page' : 'pages'} · {result.tables} detected tables · {result.images} extracted images</p>{result.scannedPages > 0 && <p>{result.scannedPages} scanned {result.scannedPages === 1 ? 'page was' : 'pages were'} preserved as images.</p>}</div>}
  </div><DocumentPdfPreview blob={file} empty={!file} emptyLabel="Choose a PDF to preview" heading="Source PDF" readyLabel="Original pages before conversion" /></div></ToolPage>
}
