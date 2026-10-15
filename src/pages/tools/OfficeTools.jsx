import { useState } from 'react'
import { Download, FileInput, FileOutput, FileText } from 'lucide-react'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { extractEmbeddedImages, extractLayout, getPdfLib } from '../../services/pdfEngine'
import { richHtmlToPdf } from '../../services/richPdf'
import { pdfToEpub, pdfToHtml, pdfToPresentation, pdfToWorkbook } from '../../services/documentExports'
import { wordToPdf } from '../../services/wordImport'
import { parseCsv } from '../../services/csv'

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])


function excelCellText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toLocaleDateString()
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text)
    if (value.result != null) return excelCellText(value.result)
    if (value.error) return String(value.error)
    if (value.formula) return `=${value.formula}`
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    return ''
  }
  return String(value)
}

function spreadsheetCellText(cell) {
  if (cell.isMerged && cell.master.address !== cell.address) return ''
  return excelCellText(cell.type === ExcelJS.ValueType.Formula && cell.result !== undefined ? cell.result : cell.value)
}

async function loadWorkbook(file) {
  const workbook = new ExcelJS.Workbook()
  if (file.name.toLowerCase().endsWith('.csv')) {
    const sheet = workbook.addWorksheet('CSV')
    parseCsv(await file.text()).forEach((values) => sheet.addRow(values))
  } else await workbook.xlsx.load(await file.arrayBuffer())
  if (!workbook.worksheets.length) throw new Error('This workbook contains no worksheets.')
  return workbook
}

async function workbookToPdf(workbook, selected, options) {
  const sheets = workbook.worksheets.filter((sheet) => selected.includes(sheet.name))
  if (!sheets.length) throw new Error('Select at least one worksheet.')
  const html = sheets.map((sheet, sheetIndex) => {
    const rows = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = []
      for (let index = 1; index <= sheet.columnCount; index++) {
        const cell = row.getCell(index)
        const value = spreadsheetCellText(cell)
        cells.push(`<td>${escapeHtml(value)}</td>`)
      }
      rows.push(`<tr>${cells.join('')}</tr>`)
    })
    return `<section${sheetIndex ? ' data-page-break="before"' : ''}><h2>${escapeHtml(sheet.name)}</h2><table>${rows.join('')}</table></section>`
  }).join('')
  return richHtmlToPdf(html || '<p>Empty workbook</p>', { ...options, tableMinColumnWidth: options.scaling === 'compact' ? 45 : 65 })
}

async function powerpointToPdf(file, progress) {
  const zip = await JSZip.loadAsync(file)
  const presentation = new DOMParser().parseFromString(await zip.file('ppt/presentation.xml')?.async('string') || '', 'text/xml')
  const slideSize = presentation.getElementsByTagName('p:sldSz')[0]
  const slideWidth = Number(slideSize?.getAttribute('cx') || 12192000)
  const slideHeight = Number(slideSize?.getAttribute('cy') || 6858000)
  const width = 960
  const height = width * slideHeight / slideWidth
  const scale = width / slideWidth
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => Number(left.match(/slide(\d+)/)[1]) - Number(right.match(/slide(\d+)/)[1]))
  if (!slides.length) throw new Error('No slides found in the PowerPoint file.')
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
  const output = await PDFDocument.create()
  const regular = await output.embedFont(StandardFonts.Helvetica)
  const bold = await output.embedFont(StandardFonts.HelveticaBold)
  const colorFrom = (element, fallback = '#111827') => {
    const value = element?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val') || fallback.slice(1)
    return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255)
  }
  const geometry = (element) => {
    const transform = element.getElementsByTagName('a:xfrm')[0]
    const offset = transform?.getElementsByTagName('a:off')[0]
    const extent = transform?.getElementsByTagName('a:ext')[0]
    if (!offset || !extent) return null
    const x = Number(offset.getAttribute('x')) * scale
    const boxWidth = Number(extent.getAttribute('cx')) * scale
    const boxHeight = Number(extent.getAttribute('cy')) * scale
    const y = height - Number(offset.getAttribute('y')) * scale - boxHeight
    return { x, y, width: boxWidth, height: boxHeight }
  }
  for (let index = 0; index < slides.length; index++) {
    const slidePath = slides[index]
    const document = new DOMParser().parseFromString(await zip.file(slidePath).async('string'), 'text/xml')
    const page = output.addPage([width, height])
    const relationships = await zip.file(slidePath.replace(/([^/]+)$/, '_rels/$1.rels'))?.async('string')
    const relationDoc = new DOMParser().parseFromString(relationships || '', 'text/xml')
    const media = new Map([...relationDoc.getElementsByTagName('Relationship')].map((entry) => [entry.getAttribute('Id'), entry.getAttribute('Target')]))
    const tree = document.getElementsByTagName('p:spTree')[0]
    for (const element of tree?.children || []) {
      const box = geometry(element)
      if (!box) continue
      if (element.localName === 'pic') {
        const relation = element.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed')
        const target = media.get(relation)
        if (!target) continue
        const imagePath = new URL(target, `https://package.local/${slidePath.slice(0, slidePath.lastIndexOf('/') + 1)}`).pathname.slice(1)
        const imageFile = zip.file(imagePath)
        if (!imageFile) continue
        const bytes = await imageFile.async('uint8array')
        const image = /\.jpe?g$/i.test(imagePath) ? await output.embedJpg(bytes) : /\.png$/i.test(imagePath) ? await output.embedPng(bytes) : null
        if (image) page.drawImage(image, box)
        continue
      }
      if (element.localName !== 'sp') continue
      const properties = element.getElementsByTagName('p:spPr')[0]
      const fill = properties?.getElementsByTagName('a:solidFill')[0]
      if (fill?.getElementsByTagName('a:srgbClr').length) page.drawRectangle({ ...box, color: colorFrom(fill) })
      const paragraphs = [...element.getElementsByTagName('a:p')]
      if (!paragraphs.length) continue
      let cursor = box.y + box.height - 18
      for (const paragraph of paragraphs) {
        const text = [...paragraph.getElementsByTagName('a:t')].map((item) => item.textContent).join('')
        if (!text) { cursor -= 16; continue }
        const run = paragraph.getElementsByTagName('a:rPr')[0]
        const size = Math.max(8, Math.min(40, Number(run?.getAttribute('sz') || 1800) / 100 * width / 960))
        const font = run?.getAttribute('b') === '1' ? bold : regular
        const draw = text.replace(/[^\x20-\xFF]/g, '?')
        page.drawText(draw, { x: box.x + 7, y: cursor, size, font, color: colorFrom(run), maxWidth: Math.max(10, box.width - 14), lineHeight: size * 1.25 })
        cursor -= size * 1.35
      }
    }
    progress(Math.round((index + 1) / slides.length * 90))
  }
  return new Blob([await output.save()], { type: 'application/pdf' })
}

function ImportTool({ toolId, accept, convert, note }) {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); setProgress(20); try { const result = await convert(file, setProgress); downloadBlob(result.blob, result.name); showToast('Conversion completed locally.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={accept} onFiles={([selected]) => setFile(selected)}><FileInput size={30} /><div className="drop-zone-title">Choose source document</div><div className="drop-zone-sub">{note}</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>{busy && <ProgressBar value={progress} label="Converting document" />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Convert and download</button></ToolPage>
}

export function WordToPdf() { return <ImportTool toolId="word-to-pdf" accept={['.docx']} note="Keeps supported headings, tables, local images, links, and page breaks." convert={async (file, progress) => ({ blob: await wordToPdf(file, progress), name: file.name.replace(/\.docx$/i, '.pdf') })} /> }
export function ExcelToPdf() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [workbook, setWorkbook] = useState(null)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [options, setOptions] = useState({ pageSize: 'A4', orientation: 'portrait', margin: 36, tableFontSize: 9, scaling: 'readable' })
  const change = (key, value) => setOptions((current) => ({ ...current, [key]: value }))
  const choose = async ([source]) => {
    if (!source) return
    setFile(source)
    setWorkbook(null)
    setBusy(true)
    setProgress(10)
    try {
      const loaded = await loadWorkbook(source)
      setWorkbook(loaded)
      setSelected(loaded.worksheets.filter((sheet) => sheet.state !== 'hidden' && sheet.state !== 'veryHidden').map((sheet) => sheet.name))
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false); setProgress(0) }
  }
  const run = async () => {
    setBusy(true)
    setProgress(30)
    try {
      const blob = await workbookToPdf(workbook, selected, options)
      setProgress(100)
      downloadBlob(blob, file.name.replace(/\.(xlsx|csv)$/i, '.pdf'))
      showToast('Spreadsheet PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const previewSheet = workbook?.worksheets.find((sheet) => selected.includes(sheet.name))
  const previewRows = previewSheet ? Array.from({ length: Math.min(previewSheet.rowCount, 8) }, (_, rowIndex) => Array.from({ length: Math.min(previewSheet.columnCount, 8) }, (_, columnIndex) => spreadsheetCellText(previewSheet.getCell(rowIndex + 1, columnIndex + 1)))) : []
  return <ToolPage toolId="excel-to-pdf">
    <div className="tool-panel"><DropZone accept={['.xlsx', '.csv']} onFiles={choose}><FileInput size={30} /><div className="drop-zone-title">Choose a workbook or CSV</div><div className="drop-zone-sub">Select sheets and set the print layout before exporting.</div></DropZone>{file && <FileItem file={file} onRemove={() => { setFile(null); setWorkbook(null); setSelected([]) }} />}</div>
    {workbook && <><div className="tool-panel"><div className="tool-panel-title">Worksheets</div><div className="action-row">{workbook.worksheets.map((sheet) => <label className="check-row" key={sheet.id}><input type="checkbox" checked={selected.includes(sheet.name)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, sheet.name] : current.filter((name) => name !== sheet.name))} /> {sheet.name}{sheet.state === 'hidden' || sheet.state === 'veryHidden' ? ' (hidden)' : ''}</label>)}</div><div className="form-grid">
      <FormGroup label="Page size"><select className="form-select" value={options.pageSize} onChange={(event) => change('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
      <FormGroup label="Orientation"><select className="form-select" value={options.orientation} onChange={(event) => change('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
      <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={options.margin} onChange={(event) => change('margin', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Table text size"><input className="form-input" type="number" min="6" max="14" value={options.tableFontSize} onChange={(event) => change('tableFontSize', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Column spacing"><select className="form-select" value={options.scaling} onChange={(event) => change('scaling', event.target.value)}><option value="readable">Comfortable columns</option><option value="compact">Compact columns</option></select></FormGroup>
    </div><p className="form-hint">Wide sheets continue in column groups. Each selected sheet starts on a new page.</p></div>{previewRows.length > 0 && <div className="tool-panel table-preview"><div className="tool-panel-title">{previewSheet.name} preview</div><table><tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => rowIndex === 0 ? <th key={columnIndex}>{value}</th> : <td key={columnIndex}>{value}</td>)}</tr>)}</tbody></table><p className="form-hint">Preview shows up to eight rows and columns.</p></div>}</>}
    {busy && <ProgressBar value={progress} label="Converting spreadsheet" />}<button className="btn btn-primary btn-lg" disabled={!workbook || !selected.length || busy} onClick={run}><Download size={17} /> Convert and download</button>
  </ToolPage>
}
export function PowerPointToPdf() { return <ImportTool toolId="powerpoint-to-pdf" accept={['.pptx']} note="Keeps basic slide positions, text, solid shapes, and embedded PNG/JPEG images. Charts and effects are not supported." convert={async (file, progress) => ({ blob: await powerpointToPdf(file, progress), name: file.name.replace(/\.pptx$/i, '.pdf') })} /> }

function layoutTable(lines, pageWidth) {
  const positions = []
  for (const item of lines.flatMap((line) => line.items)) {
    if (!positions.some((position) => Math.abs(position - item.x) < 14)) positions.push(item.x)
  }
  positions.sort((left, right) => left - right)
  if (positions.length < 3 || positions.length > 12) return null
  const cells = lines.map((line) => {
    const row = Array(positions.length).fill('')
    for (const item of line.items) {
      const column = positions.reduce((best, position, index) => Math.abs(position - item.x) < Math.abs(positions[best] - item.x) ? index : best, 0)
      row[column] = row[column] ? `${row[column]} ${item.text}` : item.text
    }
    return row
  })
  const pageLeft = positions[0]
  const available = Math.max(4000, Math.round((pageWidth - pageLeft * 2) * 20))
  const widths = positions.map((position, index) => {
    const next = positions[index + 1] || pageWidth - pageLeft
    return Math.max(500, Math.round((next - position) * 20))
  })
  const total = widths.reduce((sum, width) => sum + width, 0)
  const columnWidths = widths.map((width) => Math.round(width / total * available))
  return new Table({ columnWidths, rows: cells.map((row) => new TableRow({ children: row.map((text) => new TableCell({ children: [new Paragraph(text)] })) })) })
}

function ExportTool({ toolId, format }) {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pageRange, setPageRange] = useState('')
  const [outputFormat, setOutputFormat] = useState('xlsx')
  const [tablesOnly, setTablesOnly] = useState(true)
  const [packageAssets, setPackageAssets] = useState(false)
  const [title, setTitle] = useState('')
  const [fontFamily, setFontFamily] = useState('serif')
  const [fontSize, setFontSize] = useState(100)
  const [lineHeight, setLineHeight] = useState(1.5)
  const [readingLayout, setReadingLayout] = useState('reflow')
  const notes = {
    xlsx: 'Extract detected table rows from selected pages into Excel or CSV.',
    pptx: 'Each PDF page becomes a slide image. Page proportions are preserved.',
    html: 'Keep page appearance, selectable text, and supported links in HTML.',
    epub: 'Create a book with a contents page. Scanned pages are included as images.',
  }
  const run = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const convert = { xlsx: pdfToWorkbook, pptx: pdfToPresentation, html: pdfToHtml, epub: pdfToEpub }[format]
      const result = await convert(file, { pageRange, outputFormat, tablesOnly, packageAssets, title, fontFamily, fontSize, lineHeight, readingLayout }, setProgress)
      downloadBlob(result.blob, `${file.name.replace(/\.pdf$/i, '')}.${result.extension}`)
      showToast(`${result.extension.toUpperCase()} created.`, 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  return <ToolPage toolId={toolId}>
    <div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><FileOutput size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">{notes[format]}</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>
    <div className="tool-panel"><div className="form-grid">
      <FormGroup label="Pages" hint="Leave blank for all pages"><input className="form-input" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3, 5" /></FormGroup>
      {format === 'xlsx' && <><FormGroup label="Output format"><select className="form-select" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}><option value="xlsx">Excel workbook (.xlsx)</option><option value="csv">CSV (ZIP for multiple pages)</option></select></FormGroup><label className="check-row"><input type="checkbox" checked={tablesOnly} onChange={(event) => setTablesOnly(event.target.checked)} /> Include detected table rows only</label></>}
      {format === 'html' && <label className="check-row"><input type="checkbox" checked={packageAssets} onChange={(event) => setPackageAssets(event.target.checked)} /> Package HTML and page images in a ZIP</label>}
      {format === 'epub' && <><FormGroup label="Book title"><input className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={file?.name.replace(/\.pdf$/i, '') || 'Book title'} /></FormGroup><FormGroup label="Reading layout"><select className="form-select" value={readingLayout} onChange={(event) => setReadingLayout(event.target.value)}><option value="reflow">Reflow text for reading</option><option value="pages">Keep pages as images</option></select></FormGroup><FormGroup label="Reading font"><select className="form-select" value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></FormGroup><FormGroup label="Text size (%)"><input className="form-input" type="number" min="80" max="160" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></FormGroup><FormGroup label="Line spacing"><input className="form-input" type="number" min="1.2" max="2" step="0.1" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /></FormGroup></>}
    </div></div>
    {busy && <ProgressBar value={progress} label={`Creating ${format.toUpperCase()}`} />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Download {(format === 'xlsx' ? outputFormat : format).toUpperCase()}</button>
  </ToolPage>
}
function LayoutWordTool() {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0)
  const run = async () => { setBusy(true); try { const pages = await extractLayout(file, setProgress); const children = []; pages.forEach((page, pageIndex) => { if (pageIndex) children.push(new Paragraph({ pageBreakBefore: true })); const left = Math.min(...page.lines.flatMap((line) => line.items.map((item) => item.x)), 48); let index = 0; while (index < page.lines.length) { const group = [page.lines[index]]; while (index + group.length < page.lines.length && page.lines[index + group.length].items.length >= 3 && group.at(-1).items.length >= 3 && page.lines[index + group.length].y - group.at(-1).y < 40) group.push(page.lines[index + group.length]); if (group.length >= 2 && group[0].items.length >= 3) { const table = layoutTable(group, page.width); if (table) { children.push(table); index += group.length; continue } } const line = page.lines[index]; children.push(new Paragraph({ text: line.items.map((item) => item.text).join('    '), indent: { left: Math.max(0, Math.min(6000, Math.round(((line.items[0]?.x || left) - left) * 20))) } })); index += 1 } }); const doc = new Document({ sections: [{ children }] }); downloadBlob(await Packer.toBlob(doc), `${file.name.replace(/\.pdf$/i, '')}.docx`); showToast('DOCX created with detected table rows.', 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
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
