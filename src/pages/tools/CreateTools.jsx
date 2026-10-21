import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Camera, Download, Image as ImageIcon } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { CreatePdfComposer } from '../../components/CreatePdfComposer'
import { MarkdownPdfComposer } from '../../components/MarkdownPdfComposer'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { getPdfLib, imagesToPdf } from '../../services/pdfEngine'
import { richHtmlToPdf, sanitizeDocumentHtml } from '../../services/richPdf'
import { styledHtmlToPdf } from '../../services/htmlImport'
import { EbookPdfComposer } from '../../components/EbookPdfComposer'
import { CsvPdfComposer } from '../../components/CsvPdfComposer'
import { PdfHandwritingWorkspace } from '../../components/PdfHandwritingWorkspace'
import { TextHandwritingWorkspace } from '../../components/TextHandwritingWorkspace'
import { HandwritingCaptureWorkspace } from '../../components/HandwritingCaptureWorkspace'


function TextDocumentTool({ toolId, initialText = '', transform = (value) => value, helper, rich = false }) {
  const { showToast } = useApp()
  const [text, setText] = useState(initialText)
  const [layout, setLayout] = useState({ fontSize: 12, pageSize: 'A4', margin: 46, orientation: 'portrait', fontFamily: 'sans-serif', lineHeight: 1.35, header: '', footer: '', webLayout: 'desktop' })
  const [processing, setProcessing] = useState(false)
  const [previewResult, setPreviewResult] = useState(null)
  const [filename, setFilename] = useState(toolId)
  const pdfRequestRef = useRef(null)
  const editorRef = useRef(null)
  const updateLayout = (key, value) => setLayout((current) => ({ ...current, [key]: value }))
  const markup = rich ? text : transform(text)
  const pdfPreview = toolId === 'html-to-pdf'
  const preview = pdfPreview ? '' : sanitizeDocumentHtml(markup)
  const getPdf = useCallback((download = false) => {
    const cached = pdfRequestRef.current
    if (cached?.markup === markup && cached?.layout === layout) {
      if (download) cached.download = true
      return cached.promise
    }
    if (cached && !cached.download) cached.controller?.abort()
    const request = { markup, layout, download, controller: pdfPreview ? new AbortController() : null }
    request.promise = (pdfPreview ? styledHtmlToPdf(markup, layout, { signal: request.controller.signal }) : richHtmlToPdf(markup, layout)).catch(error => {
      if (pdfRequestRef.current === request) pdfRequestRef.current = null
      throw error
    })
    pdfRequestRef.current = request
    return request.promise
  }, [markup, layout, pdfPreview])
  useEffect(() => {
    if (!pdfPreview || !markup.trim()) return
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => {
        if (!cancelled) setPreviewResult({ markup, layout, blob })
      }).catch(error => {
        if (!cancelled) setPreviewResult({ markup, layout, error: error.message })
      })
    }, 750)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [getPdf, pdfPreview, markup, layout])
  const previewCurrent = previewResult?.markup === markup && previewResult?.layout === layout
  const runCommand = (command, value) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    setText(sanitizeDocumentHtml(editorRef.current?.innerHTML || ''))
  }
  const addImage = (file) => {
    if (!file || !['image/png', 'image/jpeg'].includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => runCommand('insertImage', reader.result)
    reader.readAsDataURL(file)
  }
  const addLink = () => {
    const address = window.prompt('Link address', 'https://')
    if (!address) return
    if (!/^(https?:|mailto:|tel:)/i.test(address)) return showToast('Use an HTTPS, HTTP, email, or telephone link.', 'warning')
    runCommand('createLink', address)
  }
  const importContent = async (file) => {
    if (!file) return
    try {
      const content = await file.text()
      if (pdfPreview) setFilename(file.name.replace(/\.[^.]+$/, ''))
      if (rich) {
        const html = sanitizeDocumentHtml(content)
        if (editorRef.current) editorRef.current.innerHTML = html
        setText(html)
      } else setText(content)
    } catch (error) { showToast(error.message, 'error') }
  }
  const paste = (event) => {
    event.preventDefault()
    const html = event.clipboardData.getData('text/html')
    if (html) runCommand('insertHTML', sanitizeDocumentHtml(html))
    else runCommand('insertText', event.clipboardData.getData('text/plain'))
  }
  const create = async () => {
    if (!text.trim()) return showToast('Add some content first.', 'warning')
    setProcessing(true)
    try {
      const blob = await getPdf(true)
      if (pdfPreview) setPreviewResult({ markup, layout, blob })
      downloadBlob(blob, `${(pdfPreview ? filename.trim().replace(/\.pdf$/i, '') : toolId) || toolId}.pdf`)
      showToast(pdfPreview ? 'HTML PDF created.' : 'PDF created locally.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setProcessing(false) }
  }
  const tokens = (value) => value.replaceAll('{page}', '1').replaceAll('{total}', '1')
  return <ToolPage toolId={toolId}><div className={`composer-layout${pdfPreview ? ' html-composer-layout' : ''}`}>
    <div className="tool-panel">
      <label className="btn btn-secondary">Import document<input type="file" hidden accept={toolId === 'markdown-to-pdf' ? '.md,.markdown,text/markdown,text/plain' : '.html,.htm,text/html,text/plain'} onChange={(event) => { importContent(event.target.files?.[0]); event.target.value = '' }} /></label>
      <FormGroup label="Document content" hint={helper}>{rich ? <>
        <div className="rich-toolbar">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('formatBlock', 'h1')}>Heading</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('formatBlock', 'p')}>Paragraph</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')}>Bold</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')}>Italic</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertUnorderedList')}>List</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertOrderedList')}>Numbered list</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={addLink}>Link</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertHTML', '<table><tr><th>Heading 1</th><th>Heading 2</th></tr><tr><td>Value 1</td><td>Value 2</td></tr></table>')}>Table</button>
          <label>Image<input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { addImage(event.target.files?.[0]); event.target.value = '' }} /></label>
        </div>
        <div ref={editorRef} className="form-textarea composer-editor rich-editor" contentEditable suppressContentEditableWarning onPaste={paste} onDrop={(event) => { event.preventDefault(); addImage(event.dataTransfer.files?.[0]) }} onInput={() => setText(sanitizeDocumentHtml(editorRef.current?.innerHTML || ''))} dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(initialText) }} />
      </> : <textarea className="form-textarea composer-editor" aria-label={pdfPreview ? 'HTML source' : 'Document content'} spellCheck={pdfPreview ? false : undefined} value={text} onChange={(event) => setText(event.target.value)} />}</FormGroup>
      {pdfPreview && <FormGroup label="PDF filename"><input className="form-input" value={filename} onChange={event => setFilename(event.target.value)} /></FormGroup>}
      <div className="form-grid">
        {pdfPreview && <FormGroup label="Web layout"><select className="form-select" value={layout.webLayout} onChange={event => updateLayout('webLayout', event.target.value)}><option value="desktop">Desktop design (fit to paper)</option><option value="paper">Responsive to paper width</option></select></FormGroup>}
        <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={(event) => updateLayout('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
        <FormGroup label="Orientation"><select className="form-select" value={layout.orientation} onChange={(event) => updateLayout('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
        <FormGroup label="Base font size"><input className="form-input" type="number" min="8" max="32" value={layout.fontSize} onChange={(event) => updateLayout('fontSize', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Font"><select className="form-select" value={layout.fontFamily} onChange={(event) => updateLayout('fontFamily', event.target.value)}><option value="sans-serif">Sans serif</option><option value="serif">Serif</option></select></FormGroup>
        <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={(event) => updateLayout('margin', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step=".1" value={layout.lineHeight} onChange={(event) => updateLayout('lineHeight', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Header"><input className="form-input" value={layout.header} onChange={(event) => updateLayout('header', event.target.value)} /></FormGroup>
        <FormGroup label="Footer" hint="Use {page} and {total} for page numbers"><input className="form-input" value={layout.footer} onChange={(event) => updateLayout('footer', event.target.value)} /></FormGroup>
      </div>
      <button className="btn btn-primary btn-lg" onClick={create} disabled={processing || !text.trim()}><Download size={17} /> {processing ? 'Creating…' : 'Create PDF'}</button>
    </div>
    {pdfPreview ? <DocumentPdfPreview blob={markup.trim() ? previewResult?.blob : null} updating={Boolean(markup.trim()) && !previewCurrent} error={previewCurrent ? previewResult?.error : ''} empty={!markup.trim()} /> : <div className="tool-panel document-preview"><span className="preview-label">Live preview</span><div className="paper-preview rich-preview" style={{ padding: layout.margin, fontFamily: layout.fontFamily, fontSize: layout.fontSize, lineHeight: layout.lineHeight }}>{layout.header && <div className="preview-running-text">{tokens(layout.header)}</div>}<div dangerouslySetInnerHTML={{ __html: preview }} />{layout.footer && <div className="preview-running-text">{tokens(layout.footer)}</div>}</div></div>}
  </div></ToolPage>
}

export function CreatePdf() { return <CreatePdfComposer /> }
export function MarkdownToPdf() { return <MarkdownPdfComposer /> }
export function HtmlToPdf() { return <TextDocumentTool toolId="html-to-pdf" initialText={'<h1>Document title</h1>\n<p>Paste HTML here, including its CSS.</p>'} helper="HTML and CSS are rendered on this app’s server. Grids, colors, inline styles and public HTTPS assets are preserved. Scripts stay disabled; use embedded images for files stored on your computer." /> }
export function TextToHandwriting() { return <TextHandwritingWorkspace /> }

export function EbookToPdf() { return <EbookPdfComposer /> }

export function CsvToPdf() { return <CsvPdfComposer /> }

function ImagePdfTool({ toolId, camera = false }) {
  const { showToast } = useApp()
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(0)
  const move = (index, direction) => { const target = index + direction; if (target < 0 || target >= files.length) return; const next = [...files]; [next[index], next[target]] = [next[target], next[index]]; setFiles(next) }
  const create = async () => { if (!files.length) return showToast('Add at least one image.', 'warning'); setProgress(25); try { const blob = await imagesToPdf(files, { pageSize: [595, 842], margin: 24 }); setProgress(100); downloadBlob(blob, `${toolId}.pdf`); showToast('PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={['image/*']} capture={camera ? 'environment' : undefined} multiple onFiles={(incoming) => setFiles((current) => [...current, ...incoming.filter((file) => file.type.startsWith('image/'))])}>{camera ? <Camera size={30} /> : <ImageIcon size={30} />}<div className="drop-zone-title">{camera ? 'Capture or choose document photos' : 'Choose handwriting images'}</div><div className="drop-zone-sub">Images stay on this device and preserve their order.</div></DropZone><div className="file-list reorder-file-list" style={{ marginTop: 12 }}>{files.map((file, index) => <div className="reorder-file" key={`${file.name}-${index}`}><FileItem file={file} onRemove={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))} /><button className="icon-btn" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button className="icon-btn" disabled={index === files.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></div>)}</div></div>{progress > 0 && progress < 100 && <ProgressBar value={progress} label="Creating PDF" />}<button className="btn btn-primary btn-lg" disabled={!files.length} onClick={create}><Download size={17} /> Create PDF</button></ToolPage>
}

export function ScanDocument() { return <ImagePdfTool toolId="scan-document" camera /> }
export function HandwritingToPdf() { return <HandwritingCaptureWorkspace /> }

export const PdfToHandwriting = PdfHandwritingWorkspace
