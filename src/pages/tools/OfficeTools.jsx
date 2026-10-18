import { memo, useEffect, useMemo, useState } from 'react'
import { Download, FileInput, FileOutput } from 'lucide-react'
import ExcelJS from 'exceljs'
import { PdfImageExtractor } from '../../components/PdfImageExtractor'
import { PdfHtmlExporter } from '../../components/PdfHtmlExporter'
import { PdfEpubExporter } from '../../components/PdfEpubExporter'
import { PdfWordExporter } from '../../components/PdfWordExporter'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { pdfToPresentation, pdfToWorkbook } from '../../services/documentExports'
import { wordToPdf, powerpointToPdf } from '../../services/wordImport'
import { parseCsv } from '../../services/csv'
import { spreadsheetTablesToPdf } from '../../services/spreadsheetPdf'

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
  const tables = sheets.map((sheet) => {
    const rows = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = []
      for (let index = 1; index <= sheet.columnCount; index++) {
        const cell = row.getCell(index)
        const value = spreadsheetCellText(cell)
        cells.push(value)
      }
      rows.push(cells)
    })
    return { name: sheet.name, rows }
  })
  return spreadsheetTablesToPdf(tables, options)
}

function ImportTool({ toolId, accept, convert, note, retainDownload = false, successMessage = 'Conversion completed locally.' }) {
  const { showToast } = useApp(); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [result, setResult] = useState(null)
  const [status, setStatus] = useState('Converting document')
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  const updateProgress = (value, label) => { setProgress(value); if (label) setStatus(label) }
  const choose = (selected) => { if (busy) return; setFile(selected); setResult(null) }
  const run = async () => { setBusy(true); setResult(null); setProgress(null); setElapsed(0); setStatus('Preparing document'); try { const converted = await convert(file, updateProgress); if (retainDownload) setResult(converted); downloadBlob(converted.blob, converted.name); showToast(successMessage, 'success') } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) } }
  return <ToolPage toolId={toolId}><div className="tool-panel"><DropZone accept={accept} onFiles={([selected]) => choose(selected)}><FileInput size={30} /><div className="drop-zone-title">Choose source document</div><div className="drop-zone-sub">{note}</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => choose(null)} /></div>}</div>{busy && <ProgressBar value={progress} label={`${status}${elapsed ? ` (${elapsed}s)` : ''}`} />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Convert and download</button>{result && <div className="tool-panel" style={{ marginTop: 16 }}><p role="status">Your PDF is ready. If it did not download automatically, tap below to save it.</p><button className="btn btn-primary" onClick={() => downloadBlob(result.blob, result.name)}><Download size={17} /> Download PDF</button></div>}</ToolPage>
}

export function WordToPdf() { return <ImportTool toolId="word-to-pdf" accept={['.docx']} note="Your file is sent to this app’s server and deleted after conversion." retainDownload successMessage="Conversion completed." convert={async (file, progress) => ({ blob: await wordToPdf(file, progress), name: file.name.replace(/\.docx$/i, '.pdf') })} /> }

const SpreadsheetPreview = memo(function SpreadsheetPreview({ sheet }) {
  const rows = useMemo(() => Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
    Array.from({ length: sheet.columnCount }, (_, columnIndex) => spreadsheetCellText(sheet.getCell(rowIndex + 1, columnIndex + 1)))), [sheet])

  return <div className="tool-panel table-preview">
    <h2 className="tool-panel-title">{sheet.name} preview</h2>
    <p className="form-hint">All {sheet.rowCount.toLocaleString()} rows and {sheet.columnCount.toLocaleString()} columns. Scroll to view the full worksheet.</p>
    {rows.length > 0 ? <div className="spreadsheet-preview-scroll" role="region" aria-label={`${sheet.name} worksheet preview`} tabIndex={0}>
      <table><thead><tr>{rows[0].map((value, index) => <th scope="col" key={index}>{value}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div> : <p className="form-hint">This worksheet is empty.</p>}
  </div>
})

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
      const blob = await workbookToPdf(workbook, selected, { ...options, includeSheetNames: !/\.csv$/i.test(file.name) })
      setProgress(100)
      downloadBlob(blob, file.name.replace(/\.(xlsx|csv)$/i, '.pdf'))
      showToast('Spreadsheet PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const previewSheets = workbook?.worksheets.filter((sheet) => selected.includes(sheet.name)) || []
  return <ToolPage toolId="excel-to-pdf">
    <div className="tool-panel"><DropZone accept={['.xlsx', '.csv']} onFiles={choose}><FileInput size={30} /><div className="drop-zone-title">Choose a workbook or CSV</div><div className="drop-zone-sub">Select sheets and set the print layout before exporting.</div></DropZone>{file && <FileItem file={file} onRemove={() => { setFile(null); setWorkbook(null); setSelected([]) }} />}</div>
    {workbook && <><div className="tool-panel"><div className="tool-panel-title">Worksheets</div><div className="action-row">{workbook.worksheets.map((sheet) => <label className="check-row" key={sheet.id}><input type="checkbox" checked={selected.includes(sheet.name)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, sheet.name] : current.filter((name) => name !== sheet.name))} /> {sheet.name}{sheet.state === 'hidden' || sheet.state === 'veryHidden' ? ' (hidden)' : ''}</label>)}</div><div className="form-grid">
      <FormGroup label="Page size"><select className="form-select" value={options.pageSize} onChange={(event) => change('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
      <FormGroup label="Orientation"><select className="form-select" value={options.orientation} onChange={(event) => change('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
      <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={options.margin} onChange={(event) => change('margin', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Table text size"><input className="form-input" type="number" min="6" max="14" value={options.tableFontSize} onChange={(event) => change('tableFontSize', Number(event.target.value))} /></FormGroup>
      <FormGroup label="Column spacing"><select className="form-select" value={options.scaling} onChange={(event) => change('scaling', event.target.value)}><option value="readable">Comfortable columns</option><option value="compact">Compact columns</option></select></FormGroup>
    </div><p className="form-hint">Wide sheets continue in column groups. Each selected sheet starts on a new page.</p></div>{previewSheets.map((sheet) => <SpreadsheetPreview key={sheet.id} sheet={sheet} />)}</>}
    {busy && <ProgressBar value={progress} label="Converting spreadsheet" />}<button className="btn btn-primary btn-lg" disabled={!workbook || !selected.length || busy} onClick={run}><Download size={17} /> Convert and download</button>
  </ToolPage>
}
export function PowerPointToPdf() { return <ImportTool toolId="powerpoint-to-pdf" accept={['.pptx']} note="Your presentation is sent to this app?s server to preserve slide layouts, then deleted after conversion." retainDownload successMessage="Presentation converted." convert={async (file, progress) => ({ blob: await powerpointToPdf(file, progress), name: file.name.replace(/\.pptx$/i, '.pdf') })} /> }

function ExportTool({ toolId, format }) {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pageRange, setPageRange] = useState('')
  const [outputFormat, setOutputFormat] = useState('xlsx')
  const [tablesOnly, setTablesOnly] = useState(true)
  const notes = {
    xlsx: 'Extract detected table rows from selected pages into Excel or CSV.',
    pptx: 'Each PDF page becomes a slide image. Page proportions are preserved.',
  }
  const run = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const convert = { xlsx: pdfToWorkbook, pptx: pdfToPresentation }[format]
      const result = await convert(file, { pageRange, outputFormat, tablesOnly }, setProgress)
      downloadBlob(result.blob, `${file.name.replace(/\.pdf$/i, '')}.${result.extension}`)
      showToast(`${result.extension.toUpperCase()} created.`, 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  return <ToolPage toolId={toolId}>
    <div className="tool-panel"><DropZone accept={['application/pdf']} onFiles={([selected]) => setFile(selected)}><FileOutput size={30} /><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">{notes[format]}</div></DropZone>{file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={() => setFile(null)} /></div>}</div>
    <div className="tool-panel"><div className="form-grid">
      <FormGroup label="Pages" hint="Leave blank for all pages"><input className="form-input" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3, 5" /></FormGroup>
      {format === 'xlsx' && <><FormGroup label="Output format"><select className="form-select" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}><option value="xlsx">Excel workbook (.xlsx)</option><option value="csv">CSV (ZIP for multiple pages)</option></select></FormGroup><label className="check-row"><input type="checkbox" checked={tablesOnly} onChange={(event) => setTablesOnly(event.target.checked)} /> Include detected table rows only</label></>}
    </div></div>
    {busy && <ProgressBar value={progress} label={`Creating ${format.toUpperCase()}`} />}<button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={run}><Download size={17} /> Download {(format === 'xlsx' ? outputFormat : format).toUpperCase()}</button>
  </ToolPage>
}
export const PdfToWord = PdfWordExporter
export const PdfToExcel = () => <ExportTool toolId="pdf-to-excel" format="xlsx" />
export const PdfToPowerPoint = () => <ExportTool toolId="pdf-to-ppt" format="pptx" />
export const PdfToHtml = PdfHtmlExporter
export const PdfToEpub = PdfEpubExporter

export const ExtractImages = PdfImageExtractor
