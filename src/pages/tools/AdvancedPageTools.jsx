import { useState } from 'react'
import { Archive, Blend, BookMarked, Crop, Download, FileText, FlipHorizontal, Grid3x3, Scissors } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { createZipFromBlobs, getPdfLib, getPdfjsLib, loadPdfBytes, splitPdfByRanges } from '../../services/pdfEngine'

function PdfInput({ files, setFiles, multiple = false }) {
  return <div className="tool-panel"><DropZone accept={['application/pdf']} multiple={multiple} onFiles={(incoming) => setFiles(incoming.filter((file) => file.type === 'application/pdf').slice(0, multiple ? undefined : 1))}><FileText size={30} /><div className="drop-zone-title">Drop {multiple ? 'PDF files' : 'a PDF'} here</div><div className="drop-zone-sub">Processing happens locally in your browser</div></DropZone>{files.map((file, index) => <div key={`${file.name}-${index}`} style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div>
}

function Action({ busy, progress, disabled, onClick, icon: Icon = Download, label }) {
  return <>{busy && <ProgressBar value={progress} label="Processing PDF" />}<button className="btn btn-primary btn-lg" disabled={disabled || busy} onClick={onClick}><Icon size={17} /> {busy ? 'Processing…' : label}</button></>
}

function useProcess() {
  const { showToast } = useApp(); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async (fn) => { setBusy(true); setProgress(10); try { await fn(setProgress); setProgress(100); showToast('PDF output created.', 'success') } catch (error) { showToast(error.message || 'Processing failed.', 'error') } finally { setBusy(false) } }
  return { busy, progress, run }
}

export function AlternateMix() {
  const [files, setFiles] = useState([]); const { busy, progress, run } = useProcess()
  const process = () => run(async (setProgress) => { if (files.length < 2) throw new Error('Choose two PDFs.'); const { PDFDocument } = await getPdfLib(); const output = await PDFDocument.create(); const sources = await Promise.all(files.slice(0, 2).map(async (file) => PDFDocument.load(await loadPdfBytes(file)))); const max = Math.max(...sources.map((pdf) => pdf.getPageCount())); for (let index = 0; index < max; index++) { for (const source of sources) if (index < source.getPageCount()) (await output.copyPages(source, [index])).forEach((page) => output.addPage(page)); setProgress(15 + (index + 1) / max * 75) } downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), 'alternate-mix.pdf') })
  return <ToolPage toolId="alternate-mix"><PdfInput files={files} setFiles={setFiles} multiple /><Action busy={busy} progress={progress} disabled={files.length < 2} onClick={process} icon={Blend} label="Mix PDFs" /></ToolPage>
}

export function SplitByText() {
  const [files, setFiles] = useState([]); const [term, setTerm] = useState(''); const { busy, progress, run } = useProcess()
  const process = () => run(async (setProgress) => { if (!term.trim()) throw new Error('Enter split text.'); const pdfjs = await getPdfjsLib(); const pdf = await pdfjs.getDocument({ data: await loadPdfBytes(files[0]) }).promise; const starts = [1]; for (let page = 2; page <= pdf.numPages; page++) { const content = await (await pdf.getPage(page)).getTextContent(); if (content.items.map((item) => item.str).join(' ').toLowerCase().includes(term.toLowerCase())) starts.push(page); setProgress(page / pdf.numPages * 50) } const ranges = starts.map((start, index) => Array.from({ length: (starts[index + 1] || pdf.numPages + 1) - start }, (_, offset) => start + offset)); const blobs = await splitPdfByRanges(files[0], ranges); downloadBlob(await createZipFromBlobs(blobs.map((blob, index) => ({ blob, name: `section-${index + 1}.pdf` }))), 'split-by-text.zip') })
  return <ToolPage toolId="split-by-text"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel"><FormGroup label="Start a new file when a page contains"><input className="form-input" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Invoice Number" /></FormGroup></div><Action busy={busy} progress={progress} disabled={!files[0] || !term} onClick={process} icon={Scissors} label="Split by text" /></ToolPage>
}

export function SplitByBookmarks() {
  const [files, setFiles] = useState([]); const { busy, progress, run } = useProcess()
  const process = () => run(async () => { const pdfjs = await getPdfjsLib(); const pdf = await pdfjs.getDocument({ data: await loadPdfBytes(files[0]) }).promise; const outline = await pdf.getOutline(); if (!outline?.length) throw new Error('This PDF has no top-level bookmarks.'); const starts = []; for (const item of outline) { const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest; if (!destination) continue; const index = await pdf.getPageIndex(destination[0]); starts.push(index + 1) } const unique = [...new Set(starts)].sort((a, b) => a - b); if (!unique.includes(1)) unique.unshift(1); const ranges = unique.map((start, index) => Array.from({ length: (unique[index + 1] || pdf.numPages + 1) - start }, (_, offset) => start + offset)); const blobs = await splitPdfByRanges(files[0], ranges); downloadBlob(await createZipFromBlobs(blobs.map((blob, index) => ({ blob, name: `${String(index + 1).padStart(2, '0')}-${outline[index]?.title || 'section'}.pdf` }))), 'bookmark-sections.zip') })
  return <ToolPage toolId="split-by-bookmarks"><PdfInput files={files} setFiles={setFiles} /><Action busy={busy} progress={progress} disabled={!files[0]} onClick={process} icon={BookMarked} label="Split by bookmarks" /></ToolPage>
}

export function SplitInHalf() {
  const [files, setFiles] = useState([]); const [mode, setMode] = useState('pages'); const { busy, progress, run } = useProcess()
  const process = () => run(async (setProgress) => {
    const { PDFDocument } = await getPdfLib()
    const bytes = await loadPdfBytes(files[0])
    const source = await PDFDocument.load(bytes)
    const count = source.getPageCount()
    if (mode === 'pages') {
      if (count < 2) throw new Error('The PDF needs at least two pages to split the document.')
      const midpoint = Math.ceil(count / 2)
      const blobs = await splitPdfByRanges(files[0], [Array.from({ length: midpoint }, (_, index) => index + 1), Array.from({ length: count - midpoint }, (_, index) => midpoint + index + 1)])
      downloadBlob(await createZipFromBlobs(blobs.map((blob, index) => ({ blob, name: `document-half-${index + 1}.pdf` }))), 'pdf-halves.zip')
      return
    }
    const names = mode === 'vertical' ? ['left', 'right'] : ['top', 'bottom']
    const outputs = []
    for (let half = 0; half < 2; half++) {
      const output = await PDFDocument.create()
      const embedded = await output.embedPdf(bytes, source.getPageIndices())
      embedded.forEach((original, index) => {
        const vertical = mode === 'vertical'
        const page = output.addPage([vertical ? original.width / 2 : original.width, vertical ? original.height : original.height / 2])
        page.drawPage(original, { x: vertical && half === 1 ? -original.width / 2 : 0, y: !vertical && half === 0 ? -original.height / 2 : 0, width: original.width, height: original.height })
        setProgress(15 + (half * count + index + 1) / (count * 2) * 75)
      })
      outputs.push({ name: `${names[half]}-half.pdf`, blob: new Blob([await output.save()], { type: 'application/pdf' }) })
    }
    downloadBlob(await createZipFromBlobs(outputs), `page-${mode}-halves.zip`)
  })
  return <ToolPage toolId="split-in-half"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel"><FormGroup label="Split layout"><select className="form-select" value={mode} onChange={(event) => setMode(event.target.value)}><option value="pages">Split document into two page groups</option><option value="vertical">Split every page into left and right halves</option><option value="horizontal">Split every page into top and bottom halves</option></select></FormGroup><p className="form-hint">Each page-half output retains the original page order. The two PDFs are downloaded as a ZIP.</p></div><Action busy={busy} progress={progress} disabled={!files[0]} onClick={process} icon={Scissors} label="Download two halves" /></ToolPage>
}

export function SplitBySize() {
  const [files, setFiles] = useState([]); const [target, setTarget] = useState(5); const { busy, progress, run } = useProcess()
  const process = () => run(async () => { const { PDFDocument } = await getPdfLib(); const source = await PDFDocument.load(await loadPdfBytes(files[0])); const groups = []; let group = []; for (let index = 0; index < source.getPageCount(); index++) { const candidate = [...group, index + 1]; const test = await PDFDocument.create(); (await test.copyPages(source, candidate.map((page) => page - 1))).forEach((page) => test.addPage(page)); const size = (await test.save()).byteLength; if (size > target * 1048576 && group.length) { groups.push(group); group = [index + 1] } else group = candidate } if (group.length) groups.push(group); const blobs = await splitPdfByRanges(files[0], groups); downloadBlob(await createZipFromBlobs(blobs.map((blob, index) => ({ blob, name: `part-${index + 1}.pdf` }))), 'size-parts.zip') })
  return <ToolPage toolId="split-by-size"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel"><FormGroup label="Maximum target per output file (MB)" hint="A single oversized page is kept intact and may exceed the target."><input className="form-input" type="number" min="0.2" step="0.1" value={target} onChange={(event) => setTarget(Number(event.target.value))} /></FormGroup></div><Action busy={busy} progress={progress} disabled={!files[0] || target <= 0} onClick={process} icon={Archive} label="Split by size" /></ToolPage>
}

export function FlipMirror() {
  const [files, setFiles] = useState([]); const [axis, setAxis] = useState('horizontal'); const { busy, progress, run } = useProcess()
  const process = () => run(async () => { const { PDFDocument } = await getPdfLib(); const bytes = await loadPdfBytes(files[0]); const source = await PDFDocument.load(bytes); const output = await PDFDocument.create(); const embedded = await output.embedPdf(bytes, source.getPageIndices()); embedded.forEach((item) => { const page = output.addPage([item.width, item.height]); page.drawPage(item, axis === 'horizontal' ? { x: item.width, y: 0, xScale: -1, yScale: 1 } : { x: 0, y: item.height, xScale: 1, yScale: -1 }) }); downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), `mirrored-${files[0].name}`) })
  return <ToolPage toolId="flip-mirror"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel"><FormGroup label="Mirror direction"><select className="form-select" value={axis} onChange={(event) => setAxis(event.target.value)}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></FormGroup></div><Action busy={busy} progress={progress} disabled={!files[0]} onClick={process} icon={FlipHorizontal} label="Mirror PDF" /></ToolPage>
}

export function NUp() {
  const [files, setFiles] = useState([]); const [perSheet, setPerSheet] = useState(4); const { busy, progress, run } = useProcess()
  const process = () => run(async () => { const { PDFDocument } = await getPdfLib(); const bytes = await loadPdfBytes(files[0]); const source = await PDFDocument.load(bytes); const output = await PDFDocument.create(); const embedded = await output.embedPdf(bytes, source.getPageIndices()); const columns = Math.ceil(Math.sqrt(perSheet)); const rows = Math.ceil(perSheet / columns); const width = 595, height = 842, cellWidth = width / columns, cellHeight = height / rows; for (let start = 0; start < embedded.length; start += perSheet) { const page = output.addPage([width, height]); embedded.slice(start, start + perSheet).forEach((item, offset) => { const column = offset % columns, row = Math.floor(offset / columns); const scale = Math.min((cellWidth - 16) / item.width, (cellHeight - 16) / item.height); page.drawPage(item, { x: column * cellWidth + (cellWidth - item.width * scale) / 2, y: height - (row + 1) * cellHeight + (cellHeight - item.height * scale) / 2, xScale: scale, yScale: scale }) }) } downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), `${perSheet}-up.pdf`) })
  return <ToolPage toolId="n-up"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel"><FormGroup label="Pages per sheet"><select className="form-select" value={perSheet} onChange={(event) => setPerSheet(Number(event.target.value))}>{[2, 4, 6, 9, 16].map((count) => <option key={count} value={count}>{count}</option>)}</select></FormGroup></div><Action busy={busy} progress={progress} disabled={!files[0]} onClick={process} icon={Grid3x3} label="Create N-up PDF" /></ToolPage>
}

export function CropResize() {
  const [files, setFiles] = useState([]); const [size, setSize] = useState('A4'); const [margin, setMargin] = useState(20); const { busy, progress, run } = useProcess(); const sizes = { A4: [595, 842], Letter: [612, 792], A3: [842, 1191] }
  const process = () => run(async () => { const { PDFDocument } = await getPdfLib(); const bytes = await loadPdfBytes(files[0]); const source = await PDFDocument.load(bytes); const output = await PDFDocument.create(); const embedded = await output.embedPdf(bytes, source.getPageIndices()); const [width, height] = sizes[size]; embedded.forEach((item) => { const page = output.addPage([width, height]); const scale = Math.min((width - margin * 2) / item.width, (height - margin * 2) / item.height); page.drawPage(item, { x: (width - item.width * scale) / 2, y: (height - item.height * scale) / 2, xScale: scale, yScale: scale }) }); downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), `resized-${size}.pdf`) })
  return <ToolPage toolId="crop-resize"><PdfInput files={files} setFiles={setFiles} /><div className="tool-panel form-grid"><FormGroup label="Output size"><select className="form-select" value={size} onChange={(event) => setSize(event.target.value)}>{Object.keys(sizes).map((name) => <option key={name}>{name}</option>)}</select></FormGroup><FormGroup label="Margin (points)"><input className="form-input" type="number" min="0" max="100" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></FormGroup></div><Action busy={busy} progress={progress} disabled={!files[0]} onClick={process} icon={Crop} label="Resize PDF" /></ToolPage>
}
