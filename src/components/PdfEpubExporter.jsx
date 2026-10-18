import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Download, Eye, ImagePlus, List, LoaderCircle, Monitor, Moon, ShieldCheck, Smartphone, Sun, Type, Upload } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { epubPreviewDocument, pdfToEpub } from '../services/pdfToEpub'
import './PdfHtmlExporter.css'
import './PdfEpubExporter.css'

const defaults = { title: '', author: '', language: 'en', description: '', pageRange: '', readingLayout: 'reflow', fontFamily: 'serif', fontSize: 100, lineHeight: 1.6, includeImages: true, includeLinks: true, includeCover: true, scale: 2, password: '' }

export function PdfEpubExporter() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [options, setOptions] = useState(defaults)
  const [cover, setCover] = useState(null)
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Preparing PDF')
  const [error, setError] = useState('')
  const [section, setSection] = useState('cover')
  const [device, setDevice] = useState('desktop')
  const [theme, setTheme] = useState('paper')
  const operation = useRef(null)
  const reader = useRef(null)
  useEffect(() => () => { operation.current?.abort(); operation.current = null }, [])
  useEffect(() => {
    const navigate = event => {
      if (event.source !== reader.current?.contentWindow || event.data?.type !== 'epub-preview-navigation') return
      const href = String(event.data.href || '')
      if (href === 'cover.xhtml' && result?.coverXhtml) setSection('cover')
      const match = href.match(/^page-(\d+)\.xhtml(?:#.*)?$/)
      if (match && result?.chapters.some(chapter => chapter.id === `page-${match[1]}`)) setSection(`page-${match[1]}`)
    }
    window.addEventListener('message', navigate)
    return () => window.removeEventListener('message', navigate)
  }, [result])
  const change = (key, value) => { setOptions(current => ({ ...current, [key]: value })); setResult(null); setError('') }
  const choose = source => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setResult(null); setError(''); setProgress(0); setCover(null); setPasswordEnabled(false)
    if (source && !/\.pdf$/i.test(source.name) && source.type !== 'application/pdf') { setFile(null); setError('Choose a PDF file to turn into an EPUB.'); return }
    setFile(source || null)
    setOptions(current => ({ ...current, title: source?.name.replace(/\.pdf$/i, '') || '', author: '', description: '', pageRange: '', password: '' }))
  }
  const chooseCover = source => {
    if (busy) return
    setResult(null); setError('')
    if (source && !/\.(png|jpe?g)$/i.test(source.name) && !['image/png', 'image/jpeg'].includes(source.type)) { setError('Choose a JPG or PNG cover image.'); return }
    if (source?.size > 20 * 1024 * 1024) { setError('Choose a cover image smaller than 20 MB.'); return }
    setCover(source || null)
  }
  const run = async (save = false) => {
    if (!file || busy) return
    if (result && save) { downloadBlob(result.blob, `${file.name.replace(/\.pdf$/i, '')}.epub`); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(0); setError(''); setResult(null); setStatus('Preparing PDF')
    try {
      const converted = await pdfToEpub(file, { ...options, password: passwordEnabled ? options.password : '', cover, signal: controller.signal }, (value, label) => {
        if (operation.current === controller) { setProgress(value); setStatus(label) }
      })
      if (operation.current !== controller || controller.signal.aborted) return
      setResult(converted); setSection(converted.coverXhtml ? 'cover' : converted.chapters[0].id)
      if (save) downloadBlob(converted.blob, `${file.name.replace(/\.pdf$/i, '')}.epub`)
      showToast('Your EPUB is ready. Browse the book preview before saving.', 'success')
    } catch (error) { if (operation.current === controller && !controller.signal.aborted) setError(error.message || 'Could not build this EPUB. Try again.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const entries = result ? [...(result.coverXhtml ? [{ id: 'cover', label: 'Cover' }] : []), { id: 'contents', label: 'Contents' }, ...result.chapters.map(chapter => ({ id: chapter.id, label: chapter.label }))] : []
  const currentIndex = entries.findIndex(entry => entry.id === section)
  const preview = useMemo(() => result ? epubPreviewDocument(result, section, theme) : '', [result, section, theme])
  const fixed = options.readingLayout === 'pages'

  return <ToolPage toolId="pdf-to-epub"><div className="html-exporter epub-exporter">
    <div className="html-export-proof"><span><ShieldCheck size={15} /> Converted on your device</span><span><BookOpen size={15} /> Read on your favorite e-reader</span><span><List size={15} /> Includes a table of contents</span></div>
    <div className="html-export-layout">
      <section className="tool-panel html-export-settings" aria-labelledby="epub-settings-title"><div className="html-export-heading"><span className="html-export-step">01</span><div><h2 id="epub-settings-title">Make it a book</h2><p>Your PDF, with a little room to read.</p></div></div>
        <DropZone accept={['application/pdf', '.pdf']} onFiles={([source]) => { if (source) choose(source) }} className="html-export-drop epub-pdf-upload"><span className="html-export-upload"><Upload size={24} /></span><div className="drop-zone-title">{file ? 'Choose another PDF' : 'Drop your PDF here'}</div><div className="drop-zone-sub">or click to browse your files</div><span className="html-export-file-type">PDF document</span></DropZone>
        {file && <FileItem file={file} onRemove={() => choose(null)} />}
        <div className="epub-main-fields"><FormGroup label="Reading layout"><select className="form-select" disabled={busy} value={options.readingLayout} onChange={event => change('readingLayout', event.target.value)}><option value="reflow">Reflow text for reading</option><option value="pages">Keep pages as images</option></select></FormGroup><p className="html-export-mode-note">{fixed ? 'Keeps the complete page design in a fixed-layout EPUB. Best for illustrated pages, forms, and complex layouts.' : 'Rebuilds readable text, headings, lists, and detected tables. Embedded images follow the text; complex columns and spacing can vary.'}</p><FormGroup label="Pages" hint="Leave blank for all pages, or enter 1-3, 5."><input className="form-input" disabled={busy} value={options.pageRange} placeholder="All pages" onChange={event => change('pageRange', event.target.value)} /></FormGroup></div>
        <details className="epub-settings-group" open><summary>Book details <BookOpen size={14} /></summary><div className="epub-settings-content"><FormGroup label="Book title"><input className="form-input" disabled={busy} value={options.title} placeholder="Book title" onChange={event => change('title', event.target.value)} /></FormGroup><div className="epub-fields-row"><FormGroup label="Author"><input className="form-input" disabled={busy} value={options.author} placeholder="Author name" onChange={event => change('author', event.target.value)} /></FormGroup><FormGroup label="Book language"><select className="form-select" disabled={busy} value={options.language} onChange={event => change('language', event.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ar">Arabic</option><option value="bn">Bengali</option><option value="ja">Japanese</option><option value="zh">Chinese</option></select></FormGroup></div></div></details>
        <details className="epub-settings-group" open><summary>Reading preferences <Type size={14} /></summary><div className="epub-settings-content"><FormGroup label="Reading font"><select className="form-select" disabled={busy || fixed} value={options.fontFamily} onChange={event => change('fontFamily', event.target.value)}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></FormGroup><div className="epub-fields-row"><FormGroup label="Text size (%)"><input type="number" className="form-input" min="80" max="160" step="5" disabled={busy || fixed} value={options.fontSize} onChange={event => change('fontSize', event.target.value)} /></FormGroup><FormGroup label="Line spacing"><input type="number" className="form-input" min="1.2" max="2" step="0.1" disabled={busy || fixed} value={options.lineHeight} onChange={event => change('lineHeight', event.target.value)} /></FormGroup></div><p>{fixed ? 'Page-image layouts keep the original typography.' : 'E-reader apps may override the book’s font and spacing preferences.'}</p></div></details>
        <details className="epub-settings-group"><summary>Cover & export options <ImagePlus size={14} /></summary><div className="epub-settings-content"><label className="check-row"><input type="checkbox" disabled={busy} checked={options.includeCover} onChange={event => change('includeCover', event.target.checked)} />Add a book cover</label>{options.includeCover && <><p>A cover is generated from your title and author, or you can add your own.</p><DropZone accept={['image/png', 'image/jpeg', '.png', '.jpg', '.jpeg']} onFiles={([source]) => { if (source) chooseCover(source) }} className="epub-cover-upload"><ImagePlus size={20} /><span>{cover ? 'Choose another cover' : 'Add a custom cover'}</span><small>JPG or PNG, up to 20 MB</small></DropZone>{cover && <FileItem file={cover} onRemove={busy ? undefined : () => chooseCover(null)} />}</>}<label className="check-row"><input type="checkbox" disabled={busy || fixed} checked={options.includeImages} onChange={event => change('includeImages', event.target.checked)} />Include embedded images</label><label className="check-row"><input type="checkbox" disabled={busy} checked={options.includeLinks} onChange={event => change('includeLinks', event.target.checked)} />Keep clickable links</label><FormGroup label="Page image quality"><select className="form-select" disabled={busy} value={options.scale} onChange={event => change('scale', Number(event.target.value))}><option value="1">Standard · 72 DPI</option><option value="1.5">Balanced · 108 DPI</option><option value="2">High · 144 DPI</option><option value="3">Maximum · 216 DPI</option></select></FormGroup><FormGroup label="Book description"><textarea className="form-textarea" rows="3" disabled={busy} value={options.description} onChange={event => change('description', event.target.value)} placeholder="Optional description" /></FormGroup><label className="check-row"><input type="checkbox" disabled={busy} checked={passwordEnabled} onChange={event => { setPasswordEnabled(event.target.checked); change('password', '') }} />This PDF needs an opening password</label>{passwordEnabled && <FormGroup label="PDF opening password"><input type="password" name="epub-document-opening-password" className="form-input" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" disabled={busy} value={options.password} onChange={event => change('password', event.target.value)} placeholder="Enter this PDF's password" /></FormGroup>}</div></details>
        {error && <p className="html-export-error" role="alert">{error}</p>}{busy && <div className="html-export-progress" role="status"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel conversion</button></div>}
        <div className="html-export-actions"><button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={() => run(false)}>{busy ? <LoaderCircle size={17} className="html-export-spin" /> : <Eye size={17} />}{busy ? 'Building your book…' : result ? 'Regenerate book' : 'Create & preview EPUB'}{!busy && <ArrowRight size={16} />}</button><button className="btn btn-secondary" disabled={!file || busy} onClick={() => run(true)}><Download size={16} />Download EPUB</button></div><p className="html-export-local"><ShieldCheck size={13} /> Your document stays in this browser.</p>
      </section>
      <section className="html-export-output" aria-label="EPUB preview" aria-busy={busy}>
        {result ? <div className="tool-panel epub-book-result"><div className="html-export-heading"><span className="html-export-step">02</span><div><h2>Your book is ready</h2><p>{result.pages} PDF {result.pages === 1 ? 'page' : 'pages'} · {result.images} images · {formatBytes(result.blob.size)}</p></div><span className="html-export-ready"><Check size={13} />Ready</span></div>
          <div className="epub-reader-navigation"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous book section" disabled={currentIndex <= 0} onClick={() => setSection(entries[currentIndex - 1].id)}><ChevronLeft size={17} /></button><select className="form-select" aria-label="Book section" value={section} onChange={event => setSection(event.target.value)}>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next book section" disabled={currentIndex >= entries.length - 1} onClick={() => setSection(entries[currentIndex + 1].id)}><ChevronRight size={17} /></button></div>
          <div className="epub-reader-tools"><div className="epub-reader-themes" role="group" aria-label="Reader theme"><button aria-label="Paper reader theme" aria-pressed={theme === 'paper'} onClick={() => setTheme('paper')}><Sun size={14} />Paper</button><button aria-label="Sepia reader theme" aria-pressed={theme === 'sepia'} onClick={() => setTheme('sepia')}><BookOpen size={14} />Sepia</button><button aria-label="Night reader theme" aria-pressed={theme === 'night'} onClick={() => setTheme('night')}><Moon size={14} />Night</button></div><div className="html-export-device"><button className="icon-btn" aria-label="Desktop book preview" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor size={16} /></button><button className="icon-btn" aria-label="Mobile book preview" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone size={16} /></button></div></div>
          <div className={`html-export-preview-body epub-reader ${device === 'mobile' ? 'is-mobile' : ''}`}><iframe ref={reader} title="EPUB book preview" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={preview} /></div><div className="html-export-result-foot"><span><BookOpen size={14} />Content matches your EPUB. E-reader presentation can vary.</span><button className="btn btn-primary btn-sm" onClick={() => run(true)}><Download size={14} />Save EPUB</button></div>
          {result.scannedPages > 0 && <div className="html-export-notice" role="status">{result.scannedPages} {result.scannedPages === 1 ? 'page has' : 'pages have'} no selectable text and {result.scannedPages === 1 ? 'is' : 'are'} preserved as images. OCR is needed for reflowable scan text.</div>}{result.warnings.length > 0 && <details className="html-export-notice"><summary>Conversion notes ({result.warnings.length})</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        </div> : file ? <DocumentPdfPreview key={file.name + file.lastModified} blob={file} heading="Source PDF" readyLabel={busy ? 'Creating your EPUB…' : 'Create your book to preview the EPUB'} /> : <div className="tool-panel epub-book-empty"><div className="html-export-heading"><span className="html-export-step">02</span><div><h2>Open a new chapter</h2><p>Your book preview will appear here.</p></div></div><div className="epub-empty-body"><div className="epub-book-art" aria-hidden="true"><span /><div><small>YOUR NEXT READ</small><BookOpen size={37} strokeWidth={1.2} /><b>A little more<br />room to read.</b><i /></div></div><h3>Take your document off the page</h3><p>Turn a PDF into a book with a cover, a contents page, and a reading experience you can make your own.</p><div className="epub-empty-tags"><span>Books & notes</span><span>Reports</span><span>Study material</span></div></div></div>}
      </section>
    </div>
  </div></ToolPage>
}
