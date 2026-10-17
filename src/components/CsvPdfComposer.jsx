import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Table } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { DropZone, FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { parseCsv } from '../services/csv'
import { spreadsheetColumnCount, spreadsheetTablesToPdf } from '../services/spreadsheetPdf'

export function CsvPdfComposer() {
  const { showToast } = useApp()
  const requestRef = useRef(null)
  const importRef = useRef(0)
  const [csv, setCsv] = useState('Name,Quantity,Price\nExample,2,99.00')
  const [filename, setFilename] = useState('table')
  const [selection, setSelection] = useState(null)
  const [layout, setLayout] = useState({ pageSize: 'A4', orientation: 'landscape', margin: 36, tableFontSize: 9, scaling: 'fit' })
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => {
    try { return { rows: parseCsv(csv), error: '' } }
    catch (error) { return { rows: [], error: error.message } }
  }, [csv])
  const columnCount = spreadsheetColumnCount(parsed.rows)
  const columns = useMemo(() => Array.from({ length: columnCount }, (_, index) => ({ index, label: parsed.rows[0]?.[index]?.trim() || `Column ${index + 1}` })), [parsed, columnCount])
  const active = useMemo(() => columns.filter(({ index }) => selection?.count !== columnCount || selection.indices.includes(index)), [columns, selection, columnCount])
  const tables = useMemo(() => [{ rows: parsed.rows.map(row => active.map(({ index }) => row[index] ?? '')) }], [parsed, active])
  const options = useMemo(() => ({ ...layout, includeSheetNames: false, tableFitWidth: layout.scaling === 'fit',
    margin: Math.max(20, Math.min(100, Number(layout.margin) || 36)),
    tableFontSize: Math.max(6, Math.min(14, Number(layout.tableFontSize) || 9)),
  }), [layout])
  const hasData = parsed.rows.length > 0 && active.length > 0
  const current = preview?.tables === tables && preview?.options === options
  const change = (key, value) => setLayout(previous => ({ ...previous, [key]: value }))
  const getPdf = useCallback(() => {
    if (requestRef.current?.tables === tables && requestRef.current.options === options) return requestRef.current.promise
    const request = { tables, options }
    request.promise = spreadsheetTablesToPdf(tables, options).catch(error => { if (requestRef.current === request) requestRef.current = null; throw error })
    requestRef.current = request
    return request.promise
  }, [tables, options])
  useEffect(() => {
    if (!hasData) return
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => { if (!cancelled) setPreview({ tables, options, blob }) }).catch(error => { if (!cancelled) setPreview({ tables, options, error: error.message }) })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [getPdf, tables, options, hasData])
  const importFile = async file => {
    if (!file) return
    const request = ++importRef.current
    try {
      const text = await file.text()
      if (request !== importRef.current) return
      setCsv(text)
      setFilename(file.name.replace(/\.csv$/i, ''))
      setSelection(null)
    } catch (error) { showToast(error.message, 'error') }
  }
  const toggle = (index, checked) => setSelection({ count: columnCount, indices: checked ? [...active.map(column => column.index), index] : active.filter(column => column.index !== index).map(column => column.index) })
  const download = async () => {
    if (!hasData || parsed.error) return
    setBusy(true)
    try {
      const blob = await getPdf()
      setPreview({ tables, options, blob })
      downloadBlob(blob, `${filename.trim().replace(/\.pdf$/i, '') || 'table'}.pdf`)
      showToast('CSV table PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }

  return <ToolPage toolId="csv-to-pdf"><div className="composer-layout csv-composer-layout">
    <div className="tool-panel">
      <h2 className="tool-panel-title">Import or paste CSV data</h2>
      <DropZone accept={['.csv', 'text/csv']} onFiles={([file]) => importFile(file)}><Table size={28} /><div className="drop-zone-title">Import CSV</div><div className="drop-zone-sub">All rows and columns stay together, including reports with a title row.</div></DropZone>
      <FormGroup label="CSV data"><textarea className="form-textarea composer-editor csv-source-editor" spellCheck={false} value={csv} onChange={event => { ++importRef.current; setCsv(event.target.value) }} placeholder="Name,Quantity,Price" /></FormGroup>
      {parsed.error && <p className="pdf-preview-error" role="alert">{parsed.error}</p>}
      <FormGroup label="PDF filename"><input className="form-input" value={filename} onChange={event => setFilename(event.target.value)} /></FormGroup>
      <details className="create-page-settings" open><summary>PDF layout <span>{layout.pageSize} · {layout.orientation === 'landscape' ? 'Landscape' : 'Portrait'}</span></summary><div className="form-grid">
        <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={event => change('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
        <FormGroup label="Page orientation"><select className="form-select" value={layout.orientation} onChange={event => change('orientation', event.target.value)}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></FormGroup>
        <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={event => change('margin', event.target.value)} onBlur={() => change('margin', options.margin)} /></FormGroup>
        <FormGroup label="Table text size"><input className="form-input" type="number" min="6" max="14" value={layout.tableFontSize} onChange={event => change('tableFontSize', event.target.value)} onBlur={() => change('tableFontSize', options.tableFontSize)} /></FormGroup>
        <FormGroup label="Column spacing"><select className="form-select" value={layout.scaling} onChange={event => change('scaling', event.target.value)}><option value="fit">Fit all columns to page</option><option value="readable">Comfortable columns (split wide tables)</option><option value="compact">Compact columns (split wide tables)</option></select></FormGroup>
      </div><p className="form-hint">Fit all columns keeps every selected column together in portrait or landscape. Text wraps within cells, and long tables continue on new pages.</p></details>
      <div className="csv-columns-heading"><h2 className="tool-panel-title">Columns to include</h2><button className="btn btn-secondary btn-sm" disabled={!columnCount} onClick={() => setSelection(null)}>Select all</button></div>
      <div className="csv-column-options">{columns.map(({ index, label }) => <label className="check-row" key={index}><input type="checkbox" checked={active.some(column => column.index === index)} onChange={event => toggle(index, event.target.checked)} />{label}</label>)}</div>
      {columnCount > 0 && !active.length && <p className="form-hint">Select at least one column to create your PDF.</p>}
      <details className="create-page-settings" open><summary>Data preview <span>{parsed.rows.length.toLocaleString()} rows · {active.length} of {columnCount} columns</span></summary>
        <p className="form-hint">All rows and selected columns are shown. Scroll to see the full table.</p>
        {hasData ? <div className="spreadsheet-preview-scroll" role="region" aria-label="CSV data preview" tabIndex={0}><table><thead><tr>{tables[0].rows[0].map((value, index) => <th scope="col" key={index}>{value}</th>)}</tr></thead><tbody>{tables[0].rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div> : <p className="form-hint">{parsed.error ? 'Fix the CSV data to see your table.' : columnCount ? 'Choose columns above.' : 'Import a CSV file or paste your data.'}</p>}
      </details>
      <button className="btn btn-primary btn-lg create-download" disabled={busy || !hasData || Boolean(parsed.error)} onClick={download}><Download size={17} />{busy ? 'Creating…' : 'Create table PDF'}</button>
    </div>
    <DocumentPdfPreview blob={hasData ? preview?.blob : null} updating={hasData && !current} error={parsed.error || (current ? preview?.error : '')} empty={!hasData} emptyLabel={columnCount ? 'Select columns to preview' : 'Add CSV data to preview'} />
  </div></ToolPage>
}
