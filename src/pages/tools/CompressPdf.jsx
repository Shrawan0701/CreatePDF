import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, Download, FileText, Link2, Minimize2, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, ProgressBar, downloadBlob } from '../../components/ui'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { COMPRESSION_PRESETS, compressPdfDetailed } from '../../services/pdfCompression'
import { formatFileSize } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'
import './CompressPdf.css'

export default function CompressPdf() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('balanced')
  const [quality, setQuality] = useState(76)
  const [maxEdge, setMaxEdge] = useState(2200)
  const [filename, setFilename] = useState('')
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('original')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const active = useRef(null)
  useEffect(() => () => active.current?.abort(), [])

  const invalidate = () => {
    active.current?.abort(); active.current = null
    setBusy(false); setResult(null); setTab('original'); setError(''); setProgress(0); setStatus('')
  }
  const choose = incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file to compress.'); return }
    if (!next.size) { setError('This file is empty. Choose a PDF with content.'); return }
    invalidate(); setFile(next); setFilename(`${next.name.replace(/\.pdf$/i, '')}-compressed`)
  }
  const reset = () => { invalidate(); setFile(null); setFilename(''); setMode('balanced'); setQuality(76); setMaxEdge(2200) }
  const compress = async () => {
    if (!file || active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setError(''); setResult(null); setTab('original'); setProgress(0)
    try {
      const output = await compressPdfDetailed(file, { mode, quality, maxEdge, signal: controller.signal,
        onProgress: (value, label) => { if (active.current === controller) { setProgress(value); setStatus(label) } },
      })
      if (controller.signal.aborted || active.current !== controller) return
      setResult(output); setTab('compressed')
      showToast(output.reason === 'signed' ? 'Original retained to preserve its digital signature.' : output.savings >= 1 ? `Saved ${formatFileSize(output.savedBytes)} (${output.savings.toFixed(1)}%).` : 'This PDF is already compact; see the size comparison.', output.savings >= 1 ? 'success' : 'info')
    } catch (failure) {
      if (active.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not compress this PDF. Try another file.')
    } finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const cancel = () => { active.current?.abort(); active.current = null; setBusy(false); setProgress(0); setStatus('Compression cancelled. You can change settings and try again.') }
  const save = () => {
    if (!result) return
    const base = filename.trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'compressed'
    downloadBlob(result.blob, `${base}.pdf`)
  }
  const minimal = result && result.savings < 1
  const savings = result ? result.savedBytes === 0 ? '0%' : result.savings < .1 ? '<0.1%' : `${result.savings.toFixed(1)}%` : ''
  const stats = result?.stats

  return <ToolPage toolId="compress-pdf">
    <div className="compress-workspace">
      <div className="compress-promises">
        <span><Link2 size={15} /> Links and selectable text stay intact</span>
        <span><FileText size={15} /> Original pages and forms retained</span>
        <span><ShieldCheck size={15} /> Private, in your browser</span>
      </div>
      <div className="tool-panel compress-upload-panel">
        <DropZone onFiles={choose} accept={['application/pdf', '.pdf']} className={`compress-upload${file ? ' has-file' : ''}`}>
          <div className="compress-file-icon"><FileText size={26} /></div>
          <div><div className="drop-zone-title">{file ? 'Choose a different PDF' : 'Choose a PDF to make smaller'}</div><div className="drop-zone-sub">{file ? 'Drop a replacement here or click to browse' : 'Drop your file here or click to browse'}</div></div>
        </DropZone>
        {file && <FileItem file={file} onRemove={reset} meta={stats ? `${stats.pages} pages` : undefined} />}
      </div>
      <div className="compress-layout">
        <div className="compress-controls tool-panel">
          <div className="compress-panel-heading"><span className="compress-step">01</span><div><h2>Compression settings</h2><p>Choose how much image detail to keep.</p></div></div>
          <fieldset className="compress-modes" disabled={busy}>
            <legend className="sr-only">Compression mode</legend>
            {Object.entries(COMPRESSION_PRESETS).map(([value, preset]) => <label key={value} className={`compress-mode${mode === value ? ' selected' : ''}`}>
              <input type="radio" name="compression-mode" value={value} checked={mode === value} onChange={() => { invalidate(); setMode(value) }} />
              <span className="compress-radio" aria-hidden="true">{mode === value && <Check size={12} />}</span>
              <span><strong>{preset.label}{value === 'balanced' && <small>Recommended</small>}</strong><span>{preset.detail}</span></span>
            </label>)}
          </fieldset>
          {mode === 'custom' && <div className="compress-custom">
            <label className="form-label" htmlFor="compress-quality">Image quality <strong>{quality}%</strong></label>
            <input id="compress-quality" type="range" min="20" max="100" step="1" value={quality} disabled={busy} onChange={event => { invalidate(); setQuality(Number(event.target.value)) }} />
            <div className="compress-range-labels"><span>Smaller file</span><span>More detail</span></div>
            <label className="form-label" htmlFor="compress-resolution">Maximum image resolution</label>
            <select id="compress-resolution" className="form-select" value={maxEdge} disabled={busy} onChange={event => { invalidate(); setMaxEdge(Number(event.target.value)) }}>
              <option value={1000}>1000 px · compact</option><option value={1400}>1400 px · screen</option><option value={1800}>1800 px · everyday</option><option value={2200}>2200 px · detailed</option><option value={3200}>3200 px · high detail</option><option value={6000}>6000 px · maximum detail</option>
            </select>
            <p className="compress-hint">Applies to each image’s longest edge. Smaller images are never enlarged.</p>
          </div>}
          <div className="compress-method"><ShieldCheck size={18} /><p>Compresses embedded images and PDF data. Keeps page text, links, bookmarks, forms, and metadata. Transparent images and small graphics retain their original pixels.</p></div>
          <label className="form-label" htmlFor="compressed-filename">Download filename</label>
          <div className="compress-filename"><input id="compressed-filename" className="form-input" value={filename} onChange={event => setFilename(event.target.value)} placeholder="compressed-document" /><span>.pdf</span></div>
          {error && <p role="alert" className="compress-error">{error}</p>}
          <div className="compress-actions">
            <button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={compress}><Minimize2 size={18} />{busy ? 'Compressing…' : result ? 'Compress again' : 'Compress PDF'}<ArrowRight size={17} /></button>
            <button className="btn btn-secondary" disabled={!result || busy} onClick={save}><Download size={17} />{result?.reason === 'already-optimized' || result?.reason === 'signed' ? 'Download original PDF' : 'Download compressed PDF'}</button>
          </div>
          {busy && <div className="compress-progress"><ProgressBar value={progress} label={status || 'Preparing compression'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel compression</button></div>}
          {!busy && status && !result && <p className="compress-hint" role="status">{status}</p>}
          <button className="compress-reset" disabled={!file && !error} onClick={reset}><RotateCcw size={13} /> Reset workspace</button>
        </div>
        <div className="compress-review">
          <section className={`tool-panel compress-summary${result && !minimal ? ' has-savings' : ''}`} aria-live="polite">
            <div className="compress-panel-heading"><span className="compress-step">02</span><div><h2>{!result ? 'See what you save' : result.reason === 'signed' ? 'Digital signature protected' : minimal ? 'Your PDF is already compact' : 'Compression complete'}</h2><p>{!result ? 'Actual sizes appear after compression.' : result.reason === 'signed' ? 'The original is retained because rewriting would invalidate its signature.' : minimal ? 'Little or no extra reduction is possible with these settings.' : `${stats.pages} pages retained, with text and links.`}</p></div></div>
            <div className="compress-size-comparison">
              <div><span>Original</span><strong title={file ? `${file.size.toLocaleString()} bytes` : ''}>{file ? formatFileSize(file.size) : '—'}</strong></div><ArrowRight size={20} aria-hidden="true" /><div><span>After compression</span><strong title={result ? `${result.compressedSize.toLocaleString()} bytes` : ''}>{result ? formatFileSize(result.compressedSize) : '—'}</strong></div>
              <div className="compress-saved"><ArrowDown size={15} /><strong>{result ? savings : '—'}</strong><span>smaller</span></div>
            </div>
            {result && <>
              <div className="compress-size-bar" aria-hidden="true"><span style={{ width: `${Math.max(1, Math.min(100, result.compressedSize / result.originalSize * 100))}%` }} /></div>
              <p className="compress-exact-saving">{result.savedBytes ? `${formatFileSize(result.savedBytes)} saved (${result.savedBytes.toLocaleString()} bytes).` : 'Original file retained, byte for byte.'} The downloaded file is never larger than your original.</p>
              {result.reason !== 'signed' && <div className="compress-details"><span><strong>{result.reason === 'already-optimized' ? 0 : stats.imagesOptimized}</strong> images compressed</span><span><strong>{result.reason === 'already-optimized' ? 0 : stats.streamsOptimized}</strong> streams optimized</span><span><strong>{result.reason === 'already-optimized' ? 0 : stats.duplicatesRemoved}</strong> duplicate streams removed</span></div>}
              {result.reason !== 'signed' && (stats.imageFailures > 0 || stats.pagesWithImageErrors > 0) && <p className="compress-hint">Some images could not be optimized and were kept in their original form.</p>}
              {minimal && result.reason !== 'signed' && <p className="compress-hint">{mode === 'lossless' ? 'Try Balanced or Smallest size to reduce large embedded photos and scans.' : mode === 'balanced' ? 'Try Smallest size for stronger image compression. Text-heavy PDFs and already compressed images may have little room to shrink.' : 'Text-heavy PDFs and already compressed images may have little room to shrink. Keeping their content can limit further reduction.'}</p>}
            </>}
            {!result && <p className="compress-hint">Photos and scans usually offer the biggest savings. Already optimized and text-only PDFs may shrink only slightly.</p>}
          </section>
          <div className="compress-preview">
            {file && <div className="compress-preview-tabs" aria-label="Compare PDFs"><button aria-pressed={tab === 'original'} onClick={() => setTab('original')}>Original PDF</button><button disabled={!result} aria-pressed={tab === 'compressed'} onClick={() => setTab('compressed')}>Compressed PDF</button></div>}
            {file ? <DocumentPdfPreview blob={tab === 'compressed' && result ? result.blob : file} heading={tab === 'compressed' ? 'Download preview' : 'Original preview'} readyLabel={tab === 'compressed' ? 'Matches your download' : 'Your source document'} /> : <div className="tool-panel compress-empty-preview"><div className="compress-empty-icon"><Minimize2 size={32} /></div><h3>Less weight, all your pages</h3><p>Add a PDF, choose a compression level, and compare the result before downloading.</p><span><Link2 size={14} /> Links remain part of the PDF</span></div>}
          </div>
        </div>
      </div>
    </div>
  </ToolPage>
}
