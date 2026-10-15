import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, Camera, Download, Image as ImageIcon, Table, Type } from 'lucide-react'
import { marked } from 'marked'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { extractText, getPdfLib, imagesToPdf } from '../../services/pdfEngine'
import { richHtmlToPdf, sanitizeDocumentHtml } from '../../services/richPdf'
import { importEbook } from '../../services/ebookImport'
import { parseCsv } from '../../services/csv'


async function handwritingTextToPdf(text, options = {}) {
  const pageWidth = 1240
  const pageHeight = 1754
  const margin = 110
  const lineHeight = Number(options.lineHeight || 58)
  const fontSize = Number(options.fontSize || 38)
  const fontFamily = options.fontFamily || '"Segoe Print", "Comic Sans MS", cursive'
  const canvas = document.createElement('canvas')
  canvas.width = pageWidth
  canvas.height = pageHeight
  const context = canvas.getContext('2d')
  context.font = `${fontSize}px ${fontFamily}`
  const lines = []
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (context.measureText(candidate).width > pageWidth - margin * 2 && line) { lines.push(line); line = word } else line = candidate
    }
    lines.push(line)
  }
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight)
  const { PDFDocument } = await getPdfLib()
  const pdf = await PDFDocument.create()
  for (let offset = 0; offset < Math.max(1, lines.length); offset += linesPerPage) {
    context.fillStyle = options.paper === 'white' ? '#ffffff' : options.paper === 'cream' ? '#fff8e7' : '#fffef8'
    context.fillRect(0, 0, pageWidth, pageHeight)
    if (options.rules !== 'none') {
      context.strokeStyle = options.rules === 'gray' ? '#d5d5d5' : '#c9d9ef'
      context.lineWidth = 2
      for (let y = margin + lineHeight; y < pageHeight - margin; y += lineHeight) { context.beginPath(); context.moveTo(margin, y); context.lineTo(pageWidth - margin, y); context.stroke() }
      context.strokeStyle = '#efb7b7'
      context.beginPath(); context.moveTo(margin + 35, 0); context.lineTo(margin + 35, pageHeight); context.stroke()
    }
    context.fillStyle = options.ink || '#17345f'
    context.font = `${fontSize}px ${fontFamily}`
    context.textBaseline = 'alphabetic'
    lines.slice(offset, offset + linesPerPage).forEach((line, index) => context.fillText(line, margin + 55, margin + (index + 1) * lineHeight - 10))
    const image = await pdf.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
    const page = pdf.addPage([595, 842])
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 })
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}

function TextDocumentTool({ toolId, initialText = '', transform = (value) => value, helper, rich = false }) {
  const { showToast } = useApp()
  const [text, setText] = useState(initialText)
  const [layout, setLayout] = useState({ fontSize: 12, pageSize: 'A4', margin: 46, orientation: 'portrait', fontFamily: 'sans-serif', lineHeight: 1.35, header: '', footer: '' })
  const [processing, setProcessing] = useState(false)
  const editorRef = useRef(null)
  const updateLayout = (key, value) => setLayout((current) => ({ ...current, [key]: value }))
  const preview = sanitizeDocumentHtml(rich ? text : transform(text))
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
      downloadBlob(await richHtmlToPdf(rich ? text : transform(text), layout), `${toolId}.pdf`)
      showToast('PDF created locally.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setProcessing(false) }
  }
  const tokens = (value) => value.replaceAll('{page}', '1').replaceAll('{total}', '1')
  return <ToolPage toolId={toolId}><div className="composer-layout">
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
      </> : <textarea className="form-textarea composer-editor" value={text} onChange={(event) => setText(event.target.value)} />}</FormGroup>
      <div className="form-grid">
        <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={(event) => updateLayout('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
        <FormGroup label="Orientation"><select className="form-select" value={layout.orientation} onChange={(event) => updateLayout('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
        <FormGroup label="Base font size"><input className="form-input" type="number" min="8" max="32" value={layout.fontSize} onChange={(event) => updateLayout('fontSize', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Font"><select className="form-select" value={layout.fontFamily} onChange={(event) => updateLayout('fontFamily', event.target.value)}><option value="sans-serif">Sans serif</option><option value="serif">Serif</option></select></FormGroup>
        <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={(event) => updateLayout('margin', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step=".1" value={layout.lineHeight} onChange={(event) => updateLayout('lineHeight', Number(event.target.value))} /></FormGroup>
        <FormGroup label="Header"><input className="form-input" value={layout.header} onChange={(event) => updateLayout('header', event.target.value)} /></FormGroup>
        <FormGroup label="Footer" hint="Use {page} and {total} for page numbers"><input className="form-input" value={layout.footer} onChange={(event) => updateLayout('footer', event.target.value)} /></FormGroup>
      </div>
      <button className="btn btn-primary btn-lg" onClick={create} disabled={processing}><Download size={17} /> {processing ? 'Creating…' : 'Create PDF'}</button>
    </div>
    <div className="tool-panel document-preview"><span className="preview-label">Live preview</span><div className="paper-preview rich-preview" style={{ padding: layout.margin, fontFamily: layout.fontFamily, fontSize: layout.fontSize, lineHeight: layout.lineHeight }}>{layout.header && <div className="preview-running-text">{tokens(layout.header)}</div>}<div dangerouslySetInnerHTML={{ __html: preview }} />{layout.footer && <div className="preview-running-text">{tokens(layout.footer)}</div>}</div></div>
  </div></ToolPage>
}

export function CreatePdf() { return <TextDocumentTool toolId="create-pdf" initialText={'<h1>Document title</h1><p>Start writing your document here.</p>'} helper="Format text, add tables and local images, then download a PDF." rich /> }
export function MarkdownToPdf() { return <TextDocumentTool toolId="markdown-to-pdf" initialText={'# Document title\n\nWrite **Markdown** here.\n\n- Lists\n- Links\n- Code'} transform={(value) => marked.parse(value)} helper="Markdown headings, lists, code, and tables render in the PDF." /> }
export function HtmlToPdf() { return <TextDocumentTool toolId="html-to-pdf" initialText={'<h1>Document title</h1>\n<p>Paste safe HTML here.</p>'} helper="Scripts and unsafe markup are removed. Embedded data-image URLs are supported." /> }
export function TextToHandwriting() {
  const { showToast } = useApp()
  const [text, setText] = useState('Dear reader,\n\nType your handwritten-style note here.')
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState({ fontFamily: '"Segoe Print", cursive', ink: '#17345f', paper: 'ivory', rules: 'blue', fontSize: 38, lineHeight: 58 })
  const change = (key, value) => setOptions((current) => ({ ...current, [key]: value }))
  const create = async () => { if (!text.trim()) return; setBusy(true); try { downloadBlob(await handwritingTextToPdf(text, options), 'handwriting.pdf'); showToast('Handwriting PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="text-to-handwriting"><div className="composer-layout"><div className="tool-panel"><FormGroup label="Text"><textarea className="form-textarea composer-editor" value={text} onChange={(event) => setText(event.target.value)} /></FormGroup><div className="form-grid"><FormGroup label="Writing style"><select className="form-select" value={options.fontFamily} onChange={(event) => change('fontFamily', event.target.value)}><option value={'"Segoe Print", cursive'}>Natural print</option><option value={'"Comic Sans MS", cursive'}>Casual</option><option value={'cursive'}>Script</option><option value={'Georgia, serif'}>Formal</option></select></FormGroup><FormGroup label="Ink"><input className="form-input" type="color" value={options.ink} onChange={(event) => change('ink', event.target.value)} /></FormGroup><FormGroup label="Paper"><select className="form-select" value={options.paper} onChange={(event) => change('paper', event.target.value)}><option value="ivory">Ivory</option><option value="white">White</option><option value="cream">Cream</option></select></FormGroup><FormGroup label="Rules"><select className="form-select" value={options.rules} onChange={(event) => change('rules', event.target.value)}><option value="blue">Blue ruled</option><option value="gray">Gray ruled</option><option value="none">Blank</option></select></FormGroup><FormGroup label="Text size"><input className="form-input" type="number" min="24" max="64" value={options.fontSize} onChange={(event) => change('fontSize', event.target.value)} /></FormGroup><FormGroup label="Line spacing"><input className="form-input" type="number" min="44" max="90" value={options.lineHeight} onChange={(event) => change('lineHeight', event.target.value)} /></FormGroup></div><button className="btn btn-primary btn-lg" disabled={busy || !text.trim()} onClick={create}><Download size={17} /> Create handwriting PDF</button></div><div className="tool-panel document-preview"><span className="preview-label">Handwriting preview</span><div className="paper-preview handwriting-preview" style={{ fontFamily: options.fontFamily, color: options.ink, fontSize: options.fontSize / 3, lineHeight: `${options.lineHeight / options.fontSize}` }}>{text}</div></div></div></ToolPage>
}

export function EbookToPdf() {
  const { showToast } = useApp()
  const editorRef = useRef(null)
  const [markup, setMarkup] = useState('')
  const [title, setTitle] = useState('')
  const [chapterCount, setChapterCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState({ fontSize: 11, pageSize: 'A4', fontFamily: 'serif', margin: 48, lineHeight: 1.5 })
  const change = (key, value) => setOptions((current) => ({ ...current, [key]: value }))
  const importBook = async ([file]) => {
    if (!file) return
    setBusy(true)
    try {
      const book = await importEbook(file)
      setMarkup(book.markup)
      setTitle(book.title)
      setChapterCount(book.chapters)
      if (editorRef.current) editorRef.current.innerHTML = book.markup
      showToast(`${book.chapters} chapter${book.chapters === 1 ? '' : 's'} imported.`, 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const create = async () => {
    if (!markup.trim()) return showToast('Import a book or enter content.', 'warning')
    setBusy(true)
    try {
      downloadBlob(await richHtmlToPdf(markup, { ...options, title }), `${title || 'ebook'}.pdf`)
      showToast('Book PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const paste = (event) => {
    event.preventDefault()
    const html = event.clipboardData.getData('text/html')
    document.execCommand(html ? 'insertHTML' : 'insertText', false, html ? sanitizeDocumentHtml(html) : event.clipboardData.getData('text/plain'))
    setMarkup(sanitizeDocumentHtml(editorRef.current?.innerHTML || ''))
  }
  return <ToolPage toolId="ebook-to-pdf">
    <div className="tool-panel"><DropZone accept={['.epub', '.txt', 'text/plain']} onFiles={importBook}><BookOpen size={30} /><div className="drop-zone-title">Drop an EPUB or TXT eBook</div><div className="drop-zone-sub">Keep chapter order, headings, lists, tables, and supported local images.</div></DropZone></div>
    <div className="tool-panel"><div className="form-grid">
      <FormGroup label="Book title"><input className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} /></FormGroup>
      <FormGroup label="Page size"><select className="form-select" value={options.pageSize} onChange={(event) => change('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
      <FormGroup label="Font"><select className="form-select" value={options.fontFamily} onChange={(event) => change('fontFamily', event.target.value)}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></FormGroup>
      <FormGroup label="Font size"><input className="form-input" type="number" min="8" max="24" value={options.fontSize} onChange={(event) => change('fontSize', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={options.margin} onChange={(event) => change('margin', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step=".1" value={options.lineHeight} onChange={(event) => change('lineHeight', Number(event.target.value))} /></FormGroup>
    </div>{chapterCount > 0 && <p className="form-hint">{chapterCount} chapters in reading order</p>}
    <div ref={editorRef} className="paper-preview rich-editor ebook-editor" contentEditable suppressContentEditableWarning aria-label="Book content" onPaste={paste} onDrop={(event) => event.preventDefault()} onInput={() => setMarkup(sanitizeDocumentHtml(editorRef.current?.innerHTML || ''))} style={{ fontFamily: options.fontFamily, fontSize: options.fontSize, lineHeight: options.lineHeight }} />
    </div><button className="btn btn-primary btn-lg" disabled={busy || !markup.trim()} onClick={create}><Download size={17} /> {busy ? 'Processing…' : 'Download PDF'}</button>
  </ToolPage>
}


export function CsvToPdf() {
  const { showToast } = useApp()
  const [csv, setCsv] = useState('Name,Quantity,Price\nExample,2,99.00')
  const [selected, setSelected] = useState(null)
  const [orientation, setOrientation] = useState('portrait')
  const parsed = useMemo(() => { try { return { rows: parseCsv(csv), error: '' } } catch (error) { return { rows: [], error: error.message } } }, [csv])
  const columns = parsed.rows[0]?.map((value, index) => ({ index, label: value || `Column ${index + 1}` })) || []
  const activeColumns = columns.filter(({ index }) => !selected || selected.includes(index))
  const create = async () => {
    if (parsed.error) return showToast(parsed.error, 'error')
    if (!parsed.rows.length || !activeColumns.length) return showToast('Select at least one CSV column.', 'warning')
    try {
      const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
      const markup = `<table>${parsed.rows.map((row, rowIndex) => `<tr>${activeColumns.map(({ index }) => rowIndex === 0 ? `<th>${escape(row[index])}</th>` : `<td>${escape(row[index])}</td>`).join('')}</tr>`).join('')}</table>`
      downloadBlob(await richHtmlToPdf(markup, { orientation }), 'table.pdf')
      showToast('Table PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') }
  }
  return <ToolPage toolId="csv-to-pdf"><div className="composer-layout"><div className="tool-panel"><DropZone accept={['.csv', 'text/csv']} onFiles={async ([file]) => file && setCsv(await file.text())}><Table size={28} /><div className="drop-zone-title">Import CSV</div></DropZone><textarea className="form-textarea composer-editor" value={csv} onChange={(event) => setCsv(event.target.value)} />{parsed.error && <p className="form-hint">{parsed.error}</p>}<FormGroup label="Page orientation"><select className="form-select" value={orientation} onChange={(event) => setOrientation(event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup><div className="tool-panel-title">Columns to include</div><div className="action-row">{columns.map(({ index, label }) => <label className="check-row" key={index}><input type="checkbox" checked={!selected || selected.includes(index)} onChange={(event) => setSelected((current) => { const included = current || columns.map((column) => column.index); return event.target.checked ? [...included, index].sort((left, right) => left - right) : included.filter((value) => value !== index) })} /> {label}</label>)}</div><button className="btn btn-primary" onClick={create}><Download size={16} /> Create table PDF</button></div><div className="tool-panel table-preview"><table><tbody>{parsed.rows.slice(0, 30).map((row, rowIndex) => <tr key={rowIndex}>{activeColumns.map(({ index }) => rowIndex === 0 ? <th key={index}>{row[index]}</th> : <td key={index}>{row[index]}</td>)}</tr>)}</tbody></table></div></div></ToolPage>
}

function ImagePdfTool({ toolId, camera = false }) {
  const { showToast } = useApp()
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(0)
  const move = (index, direction) => { const target = index + direction; if (target < 0 || target >= files.length) return; const next = [...files]; [next[index], next[target]] = [next[target], next[index]]; setFiles(next) }
  const create = async () => { if (!files.length) return showToast('Add at least one image.', 'warning'); setProgress(25); try { const blob = await imagesToPdf(files, { pageSize: [595, 842], margin: 24 }); setProgress(100); downloadBlob(blob, `${toolId}.pdf`); showToast('PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={['image/*']} capture={camera ? 'environment' : undefined} multiple onFiles={(incoming) => setFiles((current) => [...current, ...incoming.filter((file) => file.type.startsWith('image/'))])}>{camera ? <Camera size={30} /> : <ImageIcon size={30} />}<div className="drop-zone-title">{camera ? 'Capture or choose document photos' : 'Choose handwriting images'}</div><div className="drop-zone-sub">Images stay on this device and preserve their order.</div></DropZone><div className="file-list reorder-file-list" style={{ marginTop: 12 }}>{files.map((file, index) => <div className="reorder-file" key={`${file.name}-${index}`}><FileItem file={file} onRemove={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))} /><button className="icon-btn" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button className="icon-btn" disabled={index === files.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></div>)}</div></div>{progress > 0 && progress < 100 && <ProgressBar value={progress} label="Creating PDF" />}<button className="btn btn-primary btn-lg" disabled={!files.length} onClick={create}><Download size={17} /> Create PDF</button></ToolPage>
}

export function ScanDocument() { return <ImagePdfTool toolId="scan-document" camera /> }
export function HandwritingToPdf() { return <ImagePdfTool toolId="handwriting-to-pdf" /> }

export function PdfToHandwriting() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [style, setStyle] = useState('"Segoe Print", cursive')
  const [ink, setInk] = useState('#17345f')
  const convert = async () => { setBusy(true); try { const text = await extractText(file, setProgress); if (!text.trim()) throw new Error('No selectable text found. OCR is required for scanned PDFs.'); downloadBlob(await handwritingTextToPdf(text, { fontFamily: style, ink }), `handwriting-${file.name}`); showToast('Handwriting PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="pdf-to-handwriting"><div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><Type size={28} /><div className="drop-zone-title">Choose a text-based PDF</div><div className="drop-zone-sub">Selectable text is rewritten onto ruled handwriting pages.</div></DropZone>{file && <FileItem file={file} onRemove={() => setFile(null)} />}<div className="form-grid"><FormGroup label="Writing style"><select className="form-select" value={style} onChange={(event) => setStyle(event.target.value)}><option value={'"Segoe Print", cursive'}>Natural print</option><option value={'"Comic Sans MS", cursive'}>Casual</option><option value={'cursive'}>Script</option></select></FormGroup><FormGroup label="Ink"><input className="form-input" type="color" value={ink} onChange={(event) => setInk(event.target.value)} /></FormGroup></div></div>{busy && <ProgressBar value={progress} label="Extracting and rewriting text" />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={convert}><Download size={17} /> Download handwriting PDF</button></ToolPage>
}
