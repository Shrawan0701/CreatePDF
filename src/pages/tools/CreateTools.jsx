import { useMemo, useState } from 'react'
import { BookOpen, Camera, Download, Image as ImageIcon, Table, Type } from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import JSZip from 'jszip'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { extractText, getPdfLib, imagesToPdf } from '../../services/pdfEngine'

function wrapText(text, font, size, maxWidth) {
  const lines = []
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) { lines.push(line); line = word } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

async function textToPdf(text, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
  const pdf = await PDFDocument.create()
  const pageSize = options.pageSize === 'Letter' ? [612, 792] : [595, 842]
  const font = await pdf.embedFont(options.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)
  const size = Number(options.fontSize || 12)
  const margin = Number(options.margin || 48)
  const lines = wrapText(text, font, size, pageSize[0] - margin * 2)
  let page = pdf.addPage(pageSize)
  let y = pageSize[1] - margin
  for (const line of lines) {
    if (y < margin) { page = pdf.addPage(pageSize); y = pageSize[1] - margin }
    page.drawText(line, { x: margin, y, size, font, color: options.color ? rgb(...options.color) : rgb(0.08, 0.09, 0.12) })
    y -= size * Number(options.lineHeight || 1.5)
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}

async function handwritingTextToPdf(text) {
  const pageWidth = 1240
  const pageHeight = 1754
  const margin = 110
  const lineHeight = 58
  const fontSize = 38
  const canvas = document.createElement('canvas')
  canvas.width = pageWidth
  canvas.height = pageHeight
  const context = canvas.getContext('2d')
  context.font = `${fontSize}px "Segoe Print", "Comic Sans MS", cursive`
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
    context.fillStyle = '#fffef8'
    context.fillRect(0, 0, pageWidth, pageHeight)
    context.strokeStyle = '#c9d9ef'
    context.lineWidth = 2
    for (let y = margin + lineHeight; y < pageHeight - margin; y += lineHeight) { context.beginPath(); context.moveTo(margin, y); context.lineTo(pageWidth - margin, y); context.stroke() }
    context.strokeStyle = '#efb7b7'
    context.beginPath(); context.moveTo(margin + 35, 0); context.lineTo(margin + 35, pageHeight); context.stroke()
    context.fillStyle = '#17345f'
    context.font = `${fontSize}px "Segoe Print", "Comic Sans MS", cursive`
    context.textBaseline = 'alphabetic'
    lines.slice(offset, offset + linesPerPage).forEach((line, index) => context.fillText(line, margin + 55, margin + (index + 1) * lineHeight - 10))
    const image = await pdf.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
    const page = pdf.addPage([595, 842])
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 })
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}

function TextDocumentTool({ toolId, initialText = '', transform = (value) => value, helper }) {
  const { showToast } = useApp()
  const [text, setText] = useState(initialText)
  const [fontSize, setFontSize] = useState(12)
  const [pageSize, setPageSize] = useState('A4')
  const [processing, setProcessing] = useState(false)

  const create = async () => {
    if (!text.trim()) return showToast('Add some content first.', 'warning')
    setProcessing(true)
    try {
      const blob = await textToPdf(transform(text), { fontSize, pageSize })
      downloadBlob(blob, `${toolId}.pdf`)
      showToast('PDF created locally.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setProcessing(false) }
  }

  return <ToolPage toolId={toolId}><div className="composer-layout"><div className="tool-panel"><FormGroup label="Document content" hint={helper}><textarea className="form-textarea composer-editor" value={text} onChange={(event) => setText(event.target.value)} /></FormGroup><div className="form-grid"><FormGroup label="Page size"><select className="form-select" value={pageSize} onChange={(event) => setPageSize(event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup><FormGroup label="Font size"><input className="form-input" type="number" min="8" max="32" value={fontSize} onChange={(event) => setFontSize(event.target.value)} /></FormGroup></div><button className="btn btn-primary btn-lg" onClick={create} disabled={processing}><Download size={17} /> {processing ? 'Creating…' : 'Create PDF'}</button></div><div className="tool-panel document-preview"><span className="preview-label">Live preview</span><div className="paper-preview" style={{ fontSize }}>{transform(text) || 'Your document preview appears here.'}</div></div></div></ToolPage>
}

export function CreatePdf() { return <TextDocumentTool toolId="create-pdf" initialText={'Document title\n\nStart writing your document here.'} helper="Supports paragraphs and automatic page breaks." /> }
export function MarkdownToPdf() { return <TextDocumentTool toolId="markdown-to-pdf" initialText={'# Document title\n\nWrite **Markdown** here.\n\n- Lists\n- Links\n- Code'} transform={(value) => { const safe = DOMPurify.sanitize(marked.parse(value)); const node = document.createElement('div'); node.innerHTML = safe; return node.innerText }} helper="Markdown is sanitized and converted to readable PDF text." /> }
export function HtmlToPdf() { return <TextDocumentTool toolId="html-to-pdf" initialText={'<h1>Document title</h1>\n<p>Paste safe HTML here.</p>'} transform={(value) => { const node = document.createElement('div'); node.innerHTML = DOMPurify.sanitize(value, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] }); return node.innerText }} helper="Scripts, embeds, and unsafe markup are removed." /> }
export function TextToHandwriting() {
  const { showToast } = useApp()
  const [text, setText] = useState('Dear reader,\n\nType your handwritten-style note here.')
  const [busy, setBusy] = useState(false)
  const create = async () => { if (!text.trim()) return; setBusy(true); try { downloadBlob(await handwritingTextToPdf(text), 'handwriting.pdf'); showToast('Handwriting PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="text-to-handwriting"><div className="composer-layout"><div className="tool-panel"><FormGroup label="Text"><textarea className="form-textarea composer-editor" value={text} onChange={(event) => setText(event.target.value)} /></FormGroup><button className="btn btn-primary btn-lg" disabled={busy || !text.trim()} onClick={create}><Download size={17} /> Create handwriting PDF</button></div><div className="tool-panel document-preview"><span className="preview-label">Handwriting preview</span><div className="paper-preview handwriting-preview">{text}</div></div></div></ToolPage>
}

export function EbookToPdf() {
  const [text, setText] = useState('')
  const importBook = async ([file]) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.epub')) return setText(await file.text())
    const zip = await JSZip.loadAsync(file)
    const container = await zip.file('META-INF/container.xml')?.async('string')
    const root = new DOMParser().parseFromString(container || '', 'text/xml').querySelector('rootfile')?.getAttribute('full-path')
    const packageXml = root && await zip.file(root)?.async('string')
    if (!packageXml) throw new Error('Invalid EPUB package.')
    const packageDoc = new DOMParser().parseFromString(packageXml, 'text/xml')
    const manifest = Object.fromEntries([...packageDoc.querySelectorAll('manifest item')].map((item) => [item.getAttribute('id'), item.getAttribute('href')]))
    const base = root.slice(0, root.lastIndexOf('/') + 1)
    const chapters = []
    for (const item of packageDoc.querySelectorAll('spine itemref')) {
      const chapter = await zip.file(`${base}${manifest[item.getAttribute('idref')]}`)?.async('string')
      if (!chapter) continue
      const document = new DOMParser().parseFromString(chapter, 'application/xhtml+xml')
      chapters.push(document.body?.textContent?.replace(/\s+/g, ' ').trim() || '')
    }
    setText(chapters.filter(Boolean).join('\n\n'))
  }
  return <ToolPage toolId="ebook-to-pdf"><div className="tool-panel"><DropZone accept={['.epub', '.txt', 'text/plain']} onFiles={importBook}><BookOpen size={30} /><div className="drop-zone-title">Drop an EPUB or TXT eBook</div><div className="drop-zone-sub">Chapters are extracted locally in reading order.</div></DropZone></div><TextDocumentToolContent text={text} setText={setText} filename="ebook.pdf" /></ToolPage>
}

function TextDocumentToolContent({ text, setText, filename }) {
  const { showToast } = useApp()
  const create = async () => { if (!text.trim()) return showToast('Import or enter book text.', 'warning'); downloadBlob(await textToPdf(text, { fontSize: 11, lineHeight: 1.55 }), filename) }
  return <div className="tool-panel"><textarea className="form-textarea composer-editor" value={text} onChange={(event) => setText(event.target.value)} placeholder="Book content" /><button className="btn btn-primary" onClick={create}><Download size={16} /> Download PDF</button></div>
}

export function CsvToPdf() {
  const { showToast } = useApp()
  const [csv, setCsv] = useState('Name,Quantity,Price\nExample,2,99.00')
  const rows = useMemo(() => csv.split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((cell) => cell.trim())), [csv])
  const create = async () => { if (!rows.length) return; const text = rows.map((row) => row.map((cell) => cell.padEnd(18)).join(' | ')).join('\n'); downloadBlob(await textToPdf(text, { fontSize: 9, pageSize: 'A4' }), 'table.pdf'); showToast('Table PDF created.', 'success') }
  return <ToolPage toolId="csv-to-pdf"><div className="composer-layout"><div className="tool-panel"><DropZone accept={['.csv', 'text/csv']} onFiles={async ([file]) => file && setCsv(await file.text())}><Table size={28} /><div className="drop-zone-title">Import CSV</div></DropZone><textarea className="form-textarea composer-editor" value={csv} onChange={(event) => setCsv(event.target.value)} /><button className="btn btn-primary" onClick={create}><Download size={16} /> Create table PDF</button></div><div className="tool-panel table-preview"><table><tbody>{rows.slice(0, 30).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => rowIndex === 0 ? <th key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div></div></ToolPage>
}

function ImagePdfTool({ toolId, camera = false }) {
  const { showToast } = useApp()
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(0)
  const create = async () => { if (!files.length) return showToast('Add at least one image.', 'warning'); setProgress(25); try { const blob = await imagesToPdf(files, { pageSize: [595, 842], margin: 24 }); setProgress(100); downloadBlob(blob, `${toolId}.pdf`); showToast('PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={['image/*']} capture={camera ? 'environment' : undefined} multiple onFiles={(incoming) => setFiles((current) => [...current, ...incoming.filter((file) => file.type.startsWith('image/'))])}>{camera ? <Camera size={30} /> : <ImageIcon size={30} />}<div className="drop-zone-title">{camera ? 'Capture or choose document photos' : 'Choose handwriting images'}</div><div className="drop-zone-sub">Images stay on this device and preserve their order.</div></DropZone><div className="file-list" style={{ marginTop: 12 }}>{files.map((file, index) => <FileItem key={`${file.name}-${index}`} file={file} onRemove={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))} />)}</div></div>{progress > 0 && progress < 100 && <ProgressBar value={progress} label="Creating PDF" />}<button className="btn btn-primary btn-lg" onClick={create}><Download size={17} /> Create PDF</button></ToolPage>
}

export function ScanDocument() { return <ImagePdfTool toolId="scan-document" camera /> }
export function HandwritingToPdf() { return <ImagePdfTool toolId="handwriting-to-pdf" /> }

export function PdfToHandwriting() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const convert = async () => { setBusy(true); try { const text = await extractText(file, setProgress); if (!text.trim()) throw new Error('No selectable text found. OCR is required for scanned PDFs.'); downloadBlob(await handwritingTextToPdf(text), `handwriting-${file.name}`); showToast('Handwriting PDF created.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="pdf-to-handwriting"><div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><Type size={28} /><div className="drop-zone-title">Choose a text-based PDF</div><div className="drop-zone-sub">Selectable text is rewritten onto ruled handwriting pages.</div></DropZone>{file && <FileItem file={file} onRemove={() => setFile(null)} />}</div>{busy && <ProgressBar value={progress} label="Extracting and rewriting text" />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={convert}><Download size={17} /> Download handwriting PDF</button></ToolPage>
}
