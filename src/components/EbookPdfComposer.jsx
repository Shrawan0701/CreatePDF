import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Download } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FileItem, FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { importEbook } from '../services/ebookImport'
import { richHtmlToPdf, sanitizeDocumentHtml } from '../services/richPdf'

export function EbookPdfComposer() {
  const { showToast } = useApp()
  const editorRef = useRef(null)
  const requestRef = useRef(null)
  const importRef = useRef(0)
  const [book, setBook] = useState(null)
  const [source, setSource] = useState(null)
  const [title, setTitle] = useState('')
  const [filename, setFilename] = useState('ebook')
  const [markup, setMarkup] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [chapterBreaks, setChapterBreaks] = useState(true)
  const [layout, setLayout] = useState({ pageSize: 'A4', orientation: 'portrait', fontFamily: 'serif', fontSize: 11, margin: 48, lineHeight: 1.5, header: '', footer: '{page}' })
  const change = (key, value) => setLayout(previous => ({ ...previous, [key]: value }))
  const printMarkup = useMemo(() => chapterBreaks ? markup : markup.replace(/\sdata-page-break="before"/g, ''), [markup, chapterBreaks])
  const hasContent = useMemo(() => {
    const document = new DOMParser().parseFromString(markup, 'text/html')
    return Boolean(document.body.textContent.trim() || document.querySelector('img'))
  }, [markup])
  const options = useMemo(() => ({ ...layout, title: title.trim() || 'eBook', inlineFormatting: true,
    fontSize: Math.max(8, Math.min(24, Number(layout.fontSize) || 11)),
    margin: Math.max(20, Math.min(100, Number(layout.margin) || 48)),
    lineHeight: Math.max(1.1, Math.min(2, Number(layout.lineHeight) || 1.5)),
  }), [layout, title])
  const current = preview?.markup === printMarkup && preview?.options === options
  const getPdf = useCallback(() => {
    if (requestRef.current?.markup === printMarkup && requestRef.current.options === options) return requestRef.current.promise
    const request = { markup: printMarkup, options }
    request.promise = richHtmlToPdf(printMarkup, options).catch(error => { if (requestRef.current === request) requestRef.current = null; throw error })
    requestRef.current = request
    return request.promise
  }, [printMarkup, options])
  useEffect(() => {
    if (!hasContent || loading) return
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => { if (!cancelled) setPreview({ markup: printMarkup, options, blob }) }).catch(error => { if (!cancelled) setPreview({ markup: printMarkup, options, error: error.message }) })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [getPdf, printMarkup, options, hasContent, loading])
  const clear = () => {
    ++importRef.current
    setBook(null); setSource(null); setMarkup(''); setPreview(null); setError(''); setTitle(''); setFilename('ebook'); setLoading(false)
    if (editorRef.current) editorRef.current.innerHTML = ''
  }
  const choose = async file => {
    if (!file) return
    const request = ++importRef.current
    setLoading(true); setError('')
    try {
      const loaded = await importEbook(file)
      if (request !== importRef.current) return
      setBook(loaded); setSource(file); setTitle(loaded.title); setFilename(file.name.replace(/\.[^.]+$/, '')); setMarkup(loaded.markup); setPreview(null)
      if (editorRef.current) editorRef.current.innerHTML = loaded.markup
      showToast('Book imported. Check your PDF pages before downloading.', 'success')
    } catch (error) { if (request === importRef.current) { setError(error.message); showToast(error.message, 'error') } }
    finally { if (request === importRef.current) setLoading(false) }
  }
  const syncEditor = () => setMarkup(sanitizeDocumentHtml(editorRef.current?.innerHTML || ''))
  const paste = event => {
    event.preventDefault()
    const html = event.clipboardData.getData('text/html')
    document.execCommand(html ? 'insertHTML' : 'insertText', false, html ? sanitizeDocumentHtml(html) : event.clipboardData.getData('text/plain'))
    syncEditor()
  }
  const download = async () => {
    if (!hasContent || loading) return
    setBusy(true)
    try {
      const blob = await getPdf()
      setPreview({ markup: printMarkup, options, blob })
      downloadBlob(blob, `${filename.trim().replace(/\.pdf$/i, '') || 'ebook'}.pdf`)
      showToast('Book PDF created locally.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  return <ToolPage toolId="ebook-to-pdf"><div className="composer-layout ebook-composer-layout"><div className="tool-panel">
    <h2 className="tool-panel-title">Import your book</h2>
    <DropZone accept={['.epub', '.txt', 'application/epub+zip', 'text/plain']} onFiles={([file]) => choose(file)}><BookOpen size={30} /><div className="drop-zone-title">Choose an EPUB or TXT eBook</div><div className="drop-zone-sub">Chapter order, text, and supported embedded images stay on your device.</div></DropZone>
    {loading && <p className="form-hint" role="status">Reading book and preparing chapters…</p>}
    {error && <p className="pdf-preview-error" role="alert">{error}</p>}
    {source && <FileItem file={source} onRemove={clear} />}
    {book && <div className="ebook-book-info"><strong>{book.title}</strong>{book.author && <span>{book.author}</span>}<span>{book.chapters} {book.chapters === 1 ? 'chapter' : 'chapters'} in reading order</span></div>}
    <div className="form-grid"><FormGroup label="Book title"><input className="form-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Book title" /></FormGroup><FormGroup label="PDF filename"><input className="form-input" value={filename} onChange={event => setFilename(event.target.value)} /></FormGroup></div>
    <details className="create-page-settings" open><summary>Reading & page settings <span>{layout.pageSize} · {layout.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span></summary><div className="form-grid">
      <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={event => change('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
      <FormGroup label="Orientation"><select className="form-select" value={layout.orientation} onChange={event => change('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
      <FormGroup label="Font"><select className="form-select" value={layout.fontFamily} onChange={event => change('fontFamily', event.target.value)}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></FormGroup>
      <FormGroup label="Font size"><input className="form-input" type="number" min="8" max="24" value={layout.fontSize} onChange={event => change('fontSize', event.target.value)} onBlur={() => change('fontSize', options.fontSize)} /></FormGroup>
      <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={event => change('margin', event.target.value)} onBlur={() => change('margin', options.margin)} /></FormGroup>
      <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step=".1" value={layout.lineHeight} onChange={event => change('lineHeight', event.target.value)} onBlur={() => change('lineHeight', options.lineHeight)} /></FormGroup>
      <FormGroup label="Header"><input className="form-input" value={layout.header} onChange={event => change('header', event.target.value)} /></FormGroup>
      <FormGroup label="Footer" hint="Use {page} and {total} for page numbers, or leave blank."><input className="form-input" value={layout.footer} onChange={event => change('footer', event.target.value)} /></FormGroup>
    </div><label className="check-row"><input type="checkbox" checked={chapterBreaks} onChange={event => setChapterBreaks(event.target.checked)} />Start each EPUB chapter on a new page</label></details>
    {book?.contents?.length > 0 && <details className="create-page-settings"><summary>Chapter order <span>{book.contents.length} chapters</span></summary><ol className="ebook-chapter-list">{book.contents.map((heading, index) => <li key={index}>{heading}</li>)}</ol></details>}
    <details className="create-page-settings"><summary>Edit book content</summary><p className="form-hint">Make text corrections here. Your PDF preview updates automatically.</p><div ref={editorRef} className="paper-preview rich-editor ebook-editor" role="textbox" aria-multiline="true" aria-label="Book content" contentEditable suppressContentEditableWarning onInput={syncEditor} onPaste={paste} onDrop={event => event.preventDefault()} style={{ fontFamily: layout.fontFamily, fontSize: `${options.fontSize}pt`, lineHeight: options.lineHeight }} /></details>
    <button className="btn btn-primary btn-lg create-download" disabled={busy || loading || !hasContent} onClick={download}><Download size={17} />{busy ? 'Creating…' : 'Download PDF'}</button>
  </div><DocumentPdfPreview blob={hasContent && !loading ? preview?.blob : null} updating={loading || (hasContent && !current)} error={current ? preview?.error : ''} empty={!hasContent} emptyLabel="Import an eBook to preview" /></div></ToolPage>
}
