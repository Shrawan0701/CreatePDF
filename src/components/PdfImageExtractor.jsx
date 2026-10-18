import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Download, FileImage, Image, Images, LoaderCircle, Maximize2, ScanLine, ShieldCheck, Upload, X } from 'lucide-react'
import JSZip from 'jszip'
import { ToolPage } from './ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { exportPdfImage, extractPdfImages, filterPdfImages } from '../services/pdfImages'
import './PdfImageExtractor.css'

function ImagePreview({ images, index, onIndex, onClose, onDownload, downloading }) {
  const dialog = useRef(null)
  const image = images[index]
  useEffect(() => { dialog.current.showModal() }, [])
  return <dialog ref={dialog} className="extract-image-dialog" aria-labelledby="extract-preview-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }} onKeyDown={event => {
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); onIndex(index - 1) }
    if (event.key === 'ArrowRight' && index < images.length - 1) { event.preventDefault(); onIndex(index + 1) }
  }}>
    <div className="extract-preview-header"><div><h2 id="extract-preview-title">{image.name}</h2><p>{image.width.toLocaleString()} × {image.height.toLocaleString()} px · {formatBytes(image.blob.size)} · Page {image.pageNumber}</p></div><button className="icon-btn" aria-label="Close image preview" onClick={onClose}><X size={20} /></button></div>
    <div className="extract-preview-image extract-checkerboard"><img src={image.url} alt={`Extracted image from page ${image.pageNumber}`} /></div>
    <div className="extract-preview-footer"><div className="extract-inline"><button className="btn btn-secondary btn-icon" aria-label="Previous image" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft size={18} /></button><span>{index + 1} / {images.length}</span><button className="btn btn-secondary btn-icon" aria-label="Next image" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)}><ChevronRight size={18} /></button></div><button className="btn btn-primary" disabled={downloading} onClick={() => onDownload(image)}><Download size={16} /> Download image</button></div>
  </dialog>
}

export function PdfImageExtractor() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [pageRange, setPageRange] = useState('')
  const [password, setPassword] = useState('')
  const [format, setFormat] = useState('png')
  const [quality, setQuality] = useState(92)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Preparing PDF')
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ deduplicate: true, minSize: 0, page: 'all', sort: 'page' })
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(null)
  const operation = useRef(null)
  const urls = useRef([])
  useEffect(() => () => { operation.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])

  const images = useMemo(() => filterPdfImages(result?.images || [], filters), [result, filters])
  const selectedImages = images.filter(image => selected.has(image.id))
  const totalSize = selectedImages.reduce((total, image) => total + image.blob.size, 0)
  const pagesWithImages = [...new Set(result?.images.map(image => image.pageNumber) || [])]
  const allSelected = images.length > 0 && selectedImages.length === images.length
  const changeFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setPreview(null) }
  const clearResults = () => {
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []
    setResult(null); setSelected(new Set()); setPreview(null); setError('')
  }
  const choose = source => {
    if (downloading) return
    operation.current?.abort(); operation.current = null
    clearResults(); setBusy(false); setProgress(0); setPageRange(''); setPassword('')
    setFilters({ deduplicate: true, minSize: 0, page: 'all', sort: 'page' })
    if (source && !/\.pdf$/i.test(source.name) && source.type !== 'application/pdf') {
      setFile(null); setError('Choose a PDF file to extract its images.'); return
    }
    setFile(source || null)
  }
  const invalidate = (setter, value) => { setter(value); clearResults() }
  const run = async () => {
    if (!file || busy || downloading) return
    const controller = new AbortController()
    operation.current = controller
    clearResults(); setBusy(true); setProgress(0); setStatus('Preparing PDF')
    try {
      const extracted = await extractPdfImages(file, { pageRange, password, signal: controller.signal }, (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label) }
      })
      if (operation.current !== controller || controller.signal.aborted) return
      const items = extracted.images.map(image => ({ ...image, url: URL.createObjectURL(image.blob) }))
      urls.current = items.map(image => image.url)
      setResult({ ...extracted, images: items }); setSelected(new Set(items.map(image => image.id)))
      setFilters(current => ({ ...current, page: 'all' }))
      if (items.length) showToast(`${items.length} embedded image${items.length === 1 ? '' : 's'} recovered. Ready to preview.`, 'success')
    } catch (error) {
      if (operation.current === controller && !controller.signal.aborted) setError(error.message || 'Could not extract images from this PDF.')
    } finally {
      if (operation.current === controller) { setBusy(false); operation.current = null }
    }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const download = async image => {
    const items = image ? [image] : selectedImages
    if (!items.length || downloading) return
    setDownloading(true); setError('')
    try {
      if (image) {
        const output = await exportPdfImage(image, format, quality / 100)
        downloadBlob(output.blob, output.name)
      } else {
        const zip = new JSZip()
        for (const item of items) {
          const output = await exportPdfImage(item, format, quality / 100)
          zip.file(output.name, await output.blob.arrayBuffer())
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}-images.zip`)
        showToast(`${items.length} image${items.length === 1 ? '' : 's'} saved in your ZIP.`, 'success')
      }
    } catch (error) { setError(error.message || 'Could not download images. Try again.') } finally { setDownloading(false) }
  }
  const toggle = id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return <ToolPage toolId="extract-images"><div className="image-extractor">
    <div className="extract-intro"><span><ShieldCheck size={15} /> Files stay on your device</span><span><ScanLine size={15} /> Native image dimensions</span><span><Images size={15} /> Preview before downloading</span></div>
    <div className="extract-workspace">
      <section className="tool-panel extract-source" aria-labelledby="extract-source-title">
        <div className="extract-section-heading"><span className="extract-step">01</span><div><h2 id="extract-source-title">Your source PDF</h2><p>Recover photos, scans, logos, and more.</p></div></div>
        <DropZone accept={['application/pdf', '.pdf']} onFiles={([source]) => { if (source && !downloading) choose(source) }} className="extract-drop-zone">
          <span className="extract-upload-icon"><Upload size={25} /></span><div className="drop-zone-title">{file ? 'Choose another PDF' : 'Drop your PDF here'}</div><div className="drop-zone-sub">or click to browse your files</div><span className="extract-file-badge">PDF document</span>
        </DropZone>
        {file && <FileItem file={file} onRemove={downloading ? undefined : () => choose(null)} />}
        <FormGroup label="Pages to extract" hint="Leave blank for all pages, or enter 1-3, 5."><input className="form-input" disabled={busy || downloading} value={pageRange} placeholder="All pages" onChange={event => invalidate(setPageRange, event.target.value)} /></FormGroup>
        <details className="extract-password"><summary>Password-protected PDF?</summary><FormGroup label="PDF opening password"><input type="password" autoComplete="off" className="form-input" disabled={busy || downloading} value={password} onChange={event => invalidate(setPassword, event.target.value)} placeholder="Enter password" /></FormGroup></details>
        <button className="btn btn-primary btn-lg extract-run" disabled={!file || busy || downloading} onClick={run}>{busy ? <LoaderCircle className="extract-spin" size={18} /> : <Images size={18} />}{busy ? 'Extracting images…' : result ? 'Extract again' : 'Extract images'}{!busy && <ArrowRight size={16} />}</button>
        {busy && <div className="extract-progress" role="status"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel extraction</button></div>}
        {error && <p className="extract-error" role="alert">{error}</p>}
        <p className="extract-local-note"><ShieldCheck size={14} /> Extraction runs locally in your browser.</p>
      </section>

      <section className={`tool-panel extract-library ${result?.images.length ? 'has-images' : ''}`} aria-labelledby="extract-library-title" aria-busy={busy}>
        <div className="extract-section-heading"><span className="extract-step">02</span><div><h2 id="extract-library-title">Your image library</h2><p>{result ? `${result.images.length} recovered · ${result.pagesProcessed} ${result.pagesProcessed === 1 ? 'page' : 'pages'} checked` : 'A closer look at everything you extract.'}</p></div>{result?.images.length > 0 && <span className="extract-count">{images.length} {images.length === 1 ? 'image' : 'images'}</span>}</div>
        {!result && <div className="extract-empty"><div className="extract-empty-art" aria-hidden="true"><span><FileImage size={42} strokeWidth={1.2} /></span><span><Image size={45} strokeWidth={1.2} /></span><i><Check size={16} /></i></div><h3>{busy ? 'Finding your images' : 'Your images, ready to reuse'}</h3><p>{busy ? 'Reading embedded images from your selected pages. Larger scans can take a little longer.' : 'Upload a PDF and extract its images. Preview, pick your favorites, and save them individually or together.'}</p><div className="extract-empty-tags"><span>Photos</span><span>Logos</span><span>Scans</span><span>Illustrations</span></div></div>}
        {result && result.images.length === 0 && <div className="extract-empty"><FileImage size={44} strokeWidth={1.2} /><h3>No embedded images found</h3><p>These pages may contain only text or vector artwork. To save the complete page as an image, use PDF to JPG.</p><Link className="btn btn-secondary" to="/pdf-to-jpg">Open PDF to JPG <ArrowRight size={16} /></Link></div>}
        {result?.images.length > 0 && <>
          <div className="extract-filters"><FormGroup label="Source page"><select className="form-select" value={filters.page} onChange={event => changeFilter('page', event.target.value)}><option value="all">All extracted pages</option>{pagesWithImages.map(page => <option key={page} value={page}>Page {page}</option>)}</select></FormGroup><FormGroup label="Minimum dimensions"><select className="form-select" value={filters.minSize} onChange={event => changeFilter('minSize', Number(event.target.value))}><option value="0">All sizes</option><option value="32">32 × 32 px</option><option value="100">100 × 100 px</option><option value="300">300 × 300 px</option></select></FormGroup><FormGroup label="Sort images"><select className="form-select" value={filters.sort} onChange={event => changeFilter('sort', event.target.value)}><option value="page">Page order</option><option value="largest">Largest dimensions</option><option value="size">Largest file size</option></select></FormGroup></div>
          <div className="extract-selection-bar"><label className="check-row"><input type="checkbox" checked={allSelected} ref={element => { if (element) element.indeterminate = selectedImages.length > 0 && !allSelected }} onChange={() => setSelected(current => { const next = new Set(current); images.forEach(image => allSelected ? next.delete(image.id) : next.add(image.id)); return next })} />Select all <span>({selectedImages.length}/{images.length})</span></label><label className="check-row"><input type="checkbox" checked={filters.deduplicate} onChange={event => changeFilter('deduplicate', event.target.checked)} />Hide duplicates</label></div>
          {images.length ? <div className="extract-image-grid">{images.map((image, index) => <article key={image.id} className={`extract-image-card ${selected.has(image.id) ? 'is-selected' : ''}`}>
            <div className="extract-image-thumb extract-checkerboard"><button className="extract-open-image" aria-label={`Preview ${image.name}`} onClick={() => setPreview(index)}><img loading="lazy" src={image.url} alt={`Image ${index + 1} from PDF page ${image.pageNumber}`} /><span><Maximize2 size={16} /> Preview</span></button><label className="extract-image-check"><input type="checkbox" aria-label={`Select ${image.name}`} checked={selected.has(image.id)} onChange={() => toggle(image.id)} /></label><span className="extract-page-tag">Page {image.pageNumber}</span></div>
            <div className="extract-image-info"><strong title={image.name}>{image.name}</strong><span>{image.width.toLocaleString()} × {image.height.toLocaleString()} px · {formatBytes(image.blob.size)}</span>{image.pageNumbers?.length > 1 && <small>Also on pages {image.pageNumbers.slice(1).join(', ')}</small>}<button className="btn btn-secondary btn-sm" disabled={downloading} aria-label={`Download ${image.name}`} onClick={() => download(image)}><Download size={14} />Download</button></div>
          </article>)}</div> : <div className="extract-no-matches"><Image size={28} /><p>No images match these filters.</p><button className="btn btn-secondary btn-sm" onClick={() => setFilters({ deduplicate: true, minSize: 0, page: 'all', sort: 'page' })}>Clear filters</button></div>}
        </>}
        {result?.warnings.length > 0 && <div className="extract-warning" role="status"><strong>{result.warnings.length} {result.warnings.length === 1 ? 'image could' : 'images could'} not be recovered.</strong><details><summary>View details</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details><Link to="/pdf-to-jpg">Save complete pages with PDF to JPG</Link></div>}
      </section>
    </div>
    {result?.images.length > 0 && <section className="tool-panel extract-download-panel" aria-label="Export images"><div><h2>Make them yours</h2><p>{selectedImages.length} selected{format === 'png' ? ` · ${formatBytes(totalSize)}` : ''} · Original pixel dimensions</p></div><div className="extract-export-controls"><FormGroup label="Image format"><select className="form-select" disabled={downloading} value={format} onChange={event => setFormat(event.target.value)}><option value="png">PNG · lossless</option><option value="jpg">JPG · smaller files</option></select></FormGroup>{format === 'jpg' && <FormGroup label={`JPG quality: ${quality}%`} hint="Transparent areas become white."><input type="range" min="50" max="100" value={quality} disabled={downloading} onChange={event => setQuality(Number(event.target.value))} /></FormGroup>}<button className="btn btn-primary btn-lg" disabled={!selectedImages.length || downloading || busy} onClick={() => download()}>{downloading ? <LoaderCircle className="extract-spin" size={18} /> : <Download size={18} />}{downloading ? 'Preparing download…' : 'Download images ZIP'}</button></div></section>}
    <div className="extract-footnote"><FileImage size={17} /><p>Images are saved at their embedded pixel dimensions. PNG keeps transparency. Vector artwork and text are not separate raster images; <Link to="/pdf-to-jpg">export complete pages</Link> if you need everything.</p></div>
    {preview !== null && images[preview] && <ImagePreview images={images} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} onDownload={download} downloading={downloading} />}
  </div></ToolPage>
}
