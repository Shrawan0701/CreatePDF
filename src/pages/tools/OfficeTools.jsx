import { useState } from 'react'
import { Download, FileInput, FileOutput, FileText } from 'lucide-react'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { extractEmbeddedImages, extractLayout, extractText, getPdfLib, getPdfjsLib, loadPdfBytes, renderPageToCanvas } from '../../services/pdfEngine'

async function plainTextPdf(text) {
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib(); const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const size = 10; const margin = 42; const width = 595; const height = 842; let page = pdf.addPage([width, height]); let y = height - margin
  for (const paragraph of text.replace(/\r/g, '').split('\n')) { const words = paragraph.split(/\s+/); let line = ''; for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(candidate, size) > width - margin * 2 && line) { if (y < margin) { page = pdf.addPage([width, height]); y = height - margin } page.drawText(line, { x: margin, y, size, font, color: rgb(.08, .09, .12) }); y -= 15; line = word } else line = candidate } if (y < margin) { page = pdf.addPage([width, height]); y = height - margin } page.drawText(line, { x: margin, y, size, font }); y -= 17 }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}

async function docxToText(file) {
  const zip = await JSZip.loadAsync(file)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('Invalid DOCX document.')
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const body = document.getElementsByTagName('w:body')[0]
  const blocks = []
  for (const block of body?.children || []) {
    if (block.localName === 'p') blocks.push([...block.getElementsByTagName('w:t')].map((node) => node.textContent).join(''))
    if (block.localName === 'tbl') {
      for (const row of block.getElementsByTagName('w:tr')) blocks.push([...row.getElementsByTagName('w:tc')].map((cell) => [...cell.getElementsByTagName('w:t')].map((node) => node.textContent).join('')).join(' | '))
    }
  }
  return blocks.join('\n')
}

function ImportTool({ toolId, accept, convert, note }) {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); setProgress(20); try { const result = await convert(file, setProgress); downloadBlob(result.blob, result.name); showToast('Conversion completed locally.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={accept} onFiles={([selected]) => setFile(selected)}><FileInput size={30} /><div className="drop-zone-title">Choose source document</div><div className="drop-zone-sub">{note}</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>{busy && <ProgressBar value={progress} label="Converting document" />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Convert and download</button></ToolPage>
}

export function WordToPdf() { return <ImportTool toolId="word-to-pdf" accept={['.docx']} note="DOCX paragraphs and table rows are read directly from the Open XML package." convert={async (file, progress) => { const text = await docxToText(file); progress(70); return { blob: await plainTextPdf(text), name: file.name.replace(/\.docx$/i, '.pdf') } }} /> }
export function ExcelToPdf() { return <ImportTool toolId="excel-to-pdf" accept={['.xlsx', '.csv']} note="Workbook sheets, rows, and columns are converted into printable table text." convert={async (file, progress) => { const workbook = new ExcelJS.Workbook(); if (file.name.toLowerCase().endsWith('.csv')) { const rows = (await file.text()).split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))); const sheet = workbook.addWorksheet('CSV'); rows.forEach((row) => sheet.addRow(row)) } else await workbook.xlsx.load(await file.arrayBuffer()); const text = workbook.worksheets.map((sheet) => { const rows = []; sheet.eachRow({ includeEmpty: true }, (row) => rows.push(row.values.slice(1).map((value) => typeof value === 'object' && value?.text ? value.text : String(value ?? '')).map((value) => value.padEnd(18)).join(' | '))); return `SHEET: ${sheet.name}\n${rows.join('\n')}` }).join('\n\n'); progress(70); return { blob: await plainTextPdf(text), name: file.name.replace(/\.(xlsx|csv)$/i, '.pdf') } }} /> }
export function PowerPointToPdf() { return <ImportTool toolId="powerpoint-to-pdf" accept={['.pptx']} note="Slide text is extracted from the Open XML package in slide order." convert={async (file, progress) => { const zip = await JSZip.loadAsync(file); const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])); const parts = []; for (let index = 0; index < slides.length; index++) { const xml = await zip.file(slides[index]).async('string'); const node = new DOMParser().parseFromString(xml, 'text/xml'); parts.push(`SLIDE ${index + 1}\n${[...node.getElementsByTagName('a:t')].map((item) => item.textContent).join('\n')}`); progress((index + 1) / slides.length * 70) } return { blob: await plainTextPdf(parts.join('\n\n')), name: file.name.replace(/\.pptx$/i, '.pdf') } }} /> }

function layoutTable(lines) {
  const rows = lines.filter((line) => line.items.length >= 3)
  if (rows.length < 2) return null
  const columns = Math.max(...rows.map((row) => row.items.length))
  const cells = rows.map((row) => Array.from({ length: columns }, (_, index) => row.items[index]?.text || ''))
  return new Table({ rows: cells.map((row) => new TableRow({ children: row.map((text) => new TableCell({ children: [new Paragraph(text)] })) })) })
}

function ExportTool({ toolId, format }) {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); try { const base = file.name.replace(/\.pdf$/i, ''); if (format === 'xlsx') { const pages = await extractLayout(file, setProgress); const workbook = new ExcelJS.Workbook(); pages.forEach((page, pageIndex) => { const xPositions = [...new Set(page.lines.flatMap((line) => line.items.map((item) => Math.round(item.x / 12) * 12)))].sort((a, b) => a - b); const rows = page.lines.map((line) => { const row = Array(xPositions.length).fill(''); line.items.forEach((item) => { const column = xPositions.reduce((best, x, index) => Math.abs(x - item.x) < Math.abs(xPositions[best] - item.x) ? index : best, 0); row[column] = row[column] ? `${row[column]} ${item.text}` : item.text }); return row }); const sheet = workbook.addWorksheet(`Page ${pageIndex + 1}`); rows.forEach((row) => sheet.addRow(row)); sheet.columns.forEach((column, index) => { column.width = Math.min(60, Math.max(10, ...rows.map((row) => String(row[index] || '').length + 2))) }) }); downloadBlob(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`) } else { const text = await extractText(file, setProgress); if (format === 'docx') { const doc = new Document({ sections: [{ children: text.split('\n').map((line) => new Paragraph(line)) }] }); downloadBlob(await Packer.toBlob(doc), `${base}.docx`) } else if (format === 'pptx') { const PptxGenJS = (await import('pptxgenjs')).default; const pptx = new PptxGenJS(); const pdfjs = await getPdfjsLib(); const source = await pdfjs.getDocument({ data: await loadPdfBytes(file) }).promise; for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) { const canvas = await renderPageToCanvas(source, pageNumber, 1.3); const slide = pptx.addSlide(); slide.addImage({ data: canvas.toDataURL('image/png'), x: 0, y: 0, w: 10, h: 5.625 }) } const blob = await pptx.write({ outputType: 'blob' }); downloadBlob(blob, `${base}.pptx`) } else if (format === 'html') { const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;'); downloadBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>${base}</title><pre>${escaped}</pre>`], { type: 'text/html' }), `${base}.html`) } else if (format === 'epub') { const zip = new JSZip(); zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' }); zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'); zip.file('OEBPS/book.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${base}</title></head><body><pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`); zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${crypto.randomUUID()}</dc:identifier><dc:title>${base}</dc:title><dc:language>en</dc:language></metadata><manifest><item id="book" href="book.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="book"/></spine></package>`); downloadBlob(await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' }), `${base}.epub`) } } showToast(`${format.toUpperCase()} created.`, 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><FileOutput size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Selectable text is extracted locally. Scanned pages require OCR.</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>{busy && <ProgressBar value={progress} label={`Creating ${format.toUpperCase()}`} />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Download {format.toUpperCase()}</button></ToolPage>
}
function LayoutWordTool() {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); try { const pages = await extractLayout(file, setProgress); const children = []; pages.forEach((page, pageIndex) => { if (pageIndex) children.push(new Paragraph({ pageBreakBefore: true })); const tableLines = page.lines.filter((line) => line.items.length >= 4); const table = layoutTable(tableLines); page.lines.filter((line) => !tableLines.includes(line)).forEach((line) => children.push(new Paragraph({ text: line.items.map((item) => item.text).join('    '), indent: { left: Math.round((line.items[0]?.x || 0) * 20) } }))); if (table) children.push(table) }); const doc = new Document({ sections: [{ children }] }); downloadBlob(await Packer.toBlob(doc), `${file.name.replace(/\.pdf$/i, '')}.docx`); showToast('DOCX created with detected table rows.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="pdf-to-word"><div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><FileOutput size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Preserves detected rows and columns as editable Word tables.</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>{busy && <ProgressBar value={progress} label="Creating DOCX layout" />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Download DOCX</button></ToolPage>
}

export const PdfToWord = LayoutWordTool
export const PdfToExcel = () => <ExportTool toolId="pdf-to-excel" format="xlsx" />
export const PdfToPowerPoint = () => <ExportTool toolId="pdf-to-ppt" format="pptx" />
export const PdfToHtml = () => <ExportTool toolId="pdf-to-html" format="html" />
export const PdfToEpub = () => <ExportTool toolId="pdf-to-epub" format="epub" />

export function ExtractImages() {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); try { const images = await extractEmbeddedImages(file, setProgress); if (!images.length) throw new Error('No extractable embedded images were found. Use PDF to JPG to render complete pages.'); const zip = new JSZip(); images.forEach((image) => zip.file(image.name, image.blob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), `${file.name.replace(/\.pdf$/i, '')}-images.zip`); showToast(`${images.length} embedded image${images.length === 1 ? '' : 's'} extracted.`, 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId="extract-images"><div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><FileText size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Extracts embedded raster images without screenshotting complete pages.</div></DropZone>{file && <FileItem file={file} onRemove={() => setFile(null)} />}</div>{busy && <ProgressBar value={progress} label="Extracting embedded images" />}<button className="btn btn-primary" disabled={!file || busy} onClick={run}><Download size={16} /> Download images ZIP</button></ToolPage>
}
