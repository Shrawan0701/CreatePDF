import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileCheck2, FileText, LoaderCircle, LockKeyhole, Redo2, RotateCcw, Search, Trash2, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { FormPdfPreview } from './FormPdfPreview'
import { DropZone, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { createFilledFormPdf, formValueEmpty, initialFormValues, readPdfForm } from '../services/pdfForms'
import './FillFormWorkspace.css'

const emptyHistory = () => ({ past: [], values: {}, future: [] })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sampleUrl = `${import.meta.env.BASE_URL}samples/fillable-workshop-registration.pdf`

function FieldControl({ field, value, onChange, disabled }) {
  const shared = { id: field.id, disabled: disabled || field.readOnly, autoComplete: 'off', 'aria-required': field.required || undefined }
  if (field.kind === 'text') return field.multiline ? <textarea {...shared} className="form-textarea" rows={4} maxLength={field.maxLength} value={value} onChange={event => onChange(event.target.value)} /> : <input {...shared} className="form-input" type={field.password ? 'password' : 'text'} autoComplete={field.password ? 'new-password' : 'off'} maxLength={field.maxLength} value={value} onChange={event => onChange(event.target.value)} />
  if (field.kind === 'checkbox') return <label className="fill-choice"><input {...shared} type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} /> {value ? 'Checked' : 'Unchecked'}</label>
  if (field.kind === 'signature') return <span className="fill-field-note">Signature field · <a href="/sign-pdf">Open Sign PDF</a></span>
  if (field.kind === 'unsupported') return <span className="fill-field-note">Preserved in the original PDF</span>
  if (field.kind === 'radio' || field.multiple) {
    const selected = Array.isArray(value) ? value : []
    return <fieldset id={field.id} className="fill-options" disabled={disabled || field.readOnly} aria-label={field.label}>{field.options.map((option, index) => <label className="fill-choice" key={`${option.value}-${index}`}><input type={field.kind === 'radio' ? 'radio' : 'checkbox'} name={field.kind === 'radio' ? field.id : undefined} value={option.value} checked={field.kind === 'radio' ? value === option.value : selected.includes(option.value)} onChange={event => onChange(field.kind === 'radio' ? option.value : event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value))} />{option.label}</label>)}{field.kind === 'radio' && value && !field.readOnly && <button className="fill-inline-button" onClick={() => onChange('')}>Clear selection</button>}</fieldset>
  }
  if (field.editable) return <><input {...shared} className="form-input" list={`${field.id}-options`} value={value} onChange={event => onChange(event.target.value)} /><datalist id={`${field.id}-options`}>{field.options.map((option, index) => <option key={index} value={option.value}>{option.label}</option>)}</datalist></>
  return <select {...shared} className="form-select" size={field.kind === 'list' ? Math.min(6, Math.max(2, field.options.length)) : undefined} value={value} onChange={event => onChange(event.target.value)}><option value="">Select an option</option>{value && !field.options.some(option => option.value === value) && <option value={value}>{value}</option>}{field.options.map((option, index) => <option key={index} value={option.value}>{option.label}</option>)}</select>
}

export function FillFormWorkspace() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [history, setHistory] = useState(emptyHistory), [flatten, setFlatten] = useState(false)
  const [query, setQuery] = useState(''), [fieldPage, setFieldPage] = useState('all'), [previewPage, setPreviewPage] = useState(1), [active, setActive] = useState(null)
  const [preview, setPreview] = useState(null), [previewFailure, setPreviewFailure] = useState(null), [previewRetry, setPreviewRetry] = useState(0)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  const input = useRef(null), operation = useRef(null), fieldNodes = useRef(new Map())
  const values = history.values, params = useMemo(() => ({ source, values, flatten }), [source, values, flatten])
  const current = preview?.params === params, failed = previewFailure?.params === params
  const blob = source ? preview?.source === source ? preview.blob : source.file : null
  const editable = source?.fields.filter(field => !field.readOnly) || []
  const required = editable.filter(field => field.required), missing = required.filter(field => formValueEmpty(values[field.name]))
  const changed = editable.filter(field => !same(values[field.name], field.value)).length
  const filtered = source?.fields.filter(field => (fieldPage === 'all' || field.pages.includes(Number(fieldPage))) && `${field.label} ${field.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || []

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!source?.editableCount) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      createFilledFormPdf(source, values, { flatten, signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) { setPreview({ params, source, blob: result }); setPreviewFailure(null) }
      }).catch(failure => { if (!controller.signal.aborted) setPreviewFailure({ params, message: failure.message || 'Could not update the form preview.' }) })
    }, 450)
    return () => { clearTimeout(timer); controller.abort() }
  }, [params, previewRetry])

  const commit = next => {
    setError('')
    setHistory(previous => {
      const updated = typeof next === 'function' ? next(previous.values) : next
      return same(previous.values, updated) ? previous : { past: [...previous.past.slice(-49), previous.values], values: updated, future: [] }
    })
  }
  const undo = () => { setError(''); setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), values: previous.past.at(-1), future: [previous.values, ...previous.future] } : previous) }
  const redo = () => { setError(''); setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.values], values: previous.future[0], future: previous.future.slice(1) } : previous) }
  const activate = (field, focus = false) => {
    setActive(field.name)
    if (field.pages.length && !field.pages.includes(previewPage)) setPreviewPage(field.pages[0])
    if (focus) {
      setQuery(''); setFieldPage('all')
      requestAnimationFrame(() => {
        const node = fieldNodes.current.get(field.name)
        node?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        node?.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true })
      })
    }
  }
  const open = async getFile => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setStatus('Opening PDF…')
    try {
      const file = await getFile(controller.signal)
      if (!file || controller.signal.aborted) return
      const loaded = await readPdfForm(file, { signal: controller.signal })
      if (controller.signal.aborted || operation.current !== controller) return
      setSource(loaded); setHistory({ ...emptyHistory(), values: initialFormValues(loaded) }); setFlatten(false); setQuery(''); setFieldPage('all'); setPreviewPage(1); setActive(null); setPreview(null); setPreviewFailure(null)
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not open this form.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const load = files => { if (files[0]) open(() => files[0]) }
  const sample = () => open(async signal => {
    const response = await fetch(sampleUrl, { signal })
    if (!response.ok) throw new Error('Could not load the sample form. Download the sample PDF and open it here.')
    return new File([await response.blob()], 'fillable-workshop-registration.pdf', { type: 'application/pdf' })
  })
  const close = () => { if (!busy) { setSource(null); setHistory(emptyHistory()); setPreview(null); setPreviewFailure(null); setError('') } }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false) }
  const save = async () => {
    if (!source?.editableCount || busy || operation.current) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setStatus('Saving filled PDF…'); setError('')
    try {
      const output = current ? preview.blob : await createFilledFormPdf(source, values, { flatten, signal: controller.signal })
      if (controller.signal.aborted || operation.current !== controller) return
      setPreview({ params, source, blob: output }); setPreviewFailure(null)
      downloadBlob(output, `${flatten ? 'flattened' : 'filled'}-${source.file.name.replace(/\.pdf$/i, '')}.pdf`); showToast('Filled PDF saved.', 'success')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not save this form.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }

  return <ToolPage toolId="fill-form"><div className="fill-form-workspace">
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => { load(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel fill-upload"><DropZone accept={['application/pdf', '.pdf']} onFiles={load}><FileCheck2 size={32} /><div className="drop-zone-title">Choose a fillable PDF</div><div className="drop-zone-sub">Fill fields and preview the completed pages</div></DropZone><div className="fill-sample-actions"><a className="fill-inline-button" href={sampleUrl} download></a></div></div> : <>
      <div className="fill-filebar"><FileText size={20} /><div><strong title={source.file.name}>{source.file.name}</strong><span>{formatBytes(source.file.size)} · {source.pageCount} {source.pageCount === 1 ? 'page' : 'pages'} · {source.editableCount} editable fields</span></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" aria-label="Close PDF" title="Close PDF" disabled={busy} onClick={close}><X size={17} /></button></div>
      <div className="fill-actionbar"><div className="fill-history"><button className="btn btn-secondary btn-sm" disabled={busy || !history.past.length} onClick={undo} title="Undo"><Undo2 size={14} /></button><button className="btn btn-secondary btn-sm" disabled={busy || !history.future.length} onClick={redo} title="Redo"><Redo2 size={14} /></button><button className="btn btn-secondary btn-sm" disabled={busy || !changed} onClick={() => commit(initialFormValues(source))}><RotateCcw size={14} /> Restore original</button><button className="btn btn-secondary btn-sm" disabled={busy || !source.editableCount} onClick={() => commit(Object.fromEntries(source.fields.map(field => [field.name, field.readOnly ? field.value : field.kind === 'checkbox' ? false : field.multiple ? [] : ''])))}><Trash2 size={14} /> Clear fields</button></div><div className="fill-export"><select className="form-select" aria-label="PDF output format" disabled={busy || !source.editableCount} value={flatten ? 'flat' : 'editable'} onChange={event => setFlatten(event.target.value === 'flat')}><option value="editable">Keep fields editable</option><option value="flat" disabled={!source.canFlatten}>Flatten filled fields</option></select><button className="btn btn-primary" disabled={busy || !source.editableCount} onClick={save}>{busy ? <LoaderCircle size={16} className="fill-spin" /> : <Download size={16} />} Download PDF</button></div></div>
      <div className="fill-form-grid"><aside className="tool-panel fill-fields-panel"><div className="fill-fields-heading"><h2>Form fields</h2><span>{required.length ? `${required.length - missing.length} / ${required.length} required` : `${changed} changed`}</span></div>
        {source.fields.length ? <><div className="fill-field-filters"><label className="fill-search"><Search size={14} /><input aria-label="Find a form field" placeholder="Find field…" value={query} onChange={event => setQuery(event.target.value)} /></label>{source.pageCount > 1 && <select className="form-select" aria-label="Filter fields by page" value={fieldPage} onChange={event => setFieldPage(event.target.value)}><option value="all">All pages</option>{Array.from({ length: source.pageCount }, (_, index) => <option key={index} value={index + 1}>Page {index + 1}</option>)}</select>}</div><div className="fill-fields-list">{filtered.length ? filtered.map(field => <div key={field.name} ref={node => { node ? fieldNodes.current.set(field.name, node) : fieldNodes.current.delete(field.name) }} className={`fill-field${active === field.name ? ' active' : ''}${field.readOnly ? ' read-only' : ''}`} onFocusCapture={() => activate(field)}><div className="fill-field-heading"><label htmlFor={field.id} title={field.name}>{field.label}{field.required && <span className="fill-required" title="Required"> *</span>}{field.readOnly && <LockKeyhole size={11} aria-label="Read-only field" />}</label>{field.pages.length > 0 && <button title="Show field on PDF" className="fill-inline-button" onClick={() => activate(field, true)}>p.{field.pages.join(', ')}</button>}</div><FieldControl field={field} value={values[field.name] ?? field.value} disabled={busy} onChange={value => commit(previous => ({ ...previous, [field.name]: value }))} />{field.kind === 'text' && field.maxLength != null && <span className="fill-field-counter">{String(values[field.name] ?? '').length} / {field.maxLength}</span>}</div>) : <p className="fill-empty">No fields match this filter.</p>}</div>{!source.editableCount && <p className="fill-empty">These fields are read-only.</p>}{!source.canFlatten && <p className="fill-field-note">Signature and unsupported fields stay unchanged. Flattening is unavailable for this document.</p>}</> : <div className="fill-empty"><FileText size={25} /><p>No fillable fields found.</p><a className="btn btn-secondary" href="/edit-pdf">Add text in PDF editor</a><button className="fill-inline-button" disabled={busy} onClick={sample}>Try sample form</button></div>}
      </aside><FormPdfPreview blob={blob} fields={source.fields} active={active} onSelect={field => activate(field, true)} page={previewPage} onPage={setPreviewPage} updating={Boolean(source.editableCount) && !current && !failed} error={failed ? previewFailure.message : ''} />
      </div>{failed && <button className="btn btn-secondary btn-sm fill-retry" disabled={busy} onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button>}
    </>}
    {busy && <div className="fill-progress" role="status"><LoaderCircle size={15} className="fill-spin" /> {status}<button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
    {error && <p className="fill-form-error" role="alert">{error}</p>}
  </div></ToolPage>
}
