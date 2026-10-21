import { useEffect, useRef, useState } from 'react'
import { Archive, ArrowDown, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronDown, Copy, Download, FileImage, FileText, FolderOpen, GitBranch, Play, Plus, Save, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FormGroup, ProgressBar, downloadBlob, formatBytes } from '../../components/ui'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { useApp } from '../../context/AppContext'
import { deleteWorkflow, getWorkflows, saveWorkflow } from '../../services/storage'
import { createPdfArchive } from '../../services/pdfZip'
import { WORKFLOW_OPERATIONS, WORKFLOW_PRESETS, makeWorkflowStep, normalizeWorkflowStep, parseWorkflowConfiguration, planWorkflow, readWorkflowSource, runPdfWorkflow, workflowConfiguration, workflowFilename } from '../../services/pdfWorkflow'
import './WorkflowBuilder.css'

const countLabel = summary => `${summary.files} ${summary.files === 1 ? 'file' : 'files'} · ${summary.pages} ${summary.pages === 1 ? 'page' : 'pages'}${summary.images ? ` · ${summary.images} ${summary.images === 1 ? 'image' : 'images'}` : ''}`
const positions = { center: 'Center', 'top-center': 'Top center', 'bottom-center': 'Bottom center', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' }

function StepSettings({ step, update }) {
  const s = step.settings
  const select = (key, label, choices) => <FormGroup label={label}><select className="form-select" value={s[key]} onChange={event => update({ [key]: event.target.value })}>{Object.entries(choices).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></FormGroup>
  const input = (key, label, props = {}) => <FormGroup label={label}><input className="form-input" value={s[key]} onChange={event => update({ [key]: event.target.value })} {...props} /></FormGroup>
  const pages = () => input('pages', 'Pages (blank = all)', { placeholder: 'All pages, or 1-3, 5' })
  return <div className="wf-step-settings">
    {step.type === 'merge' && <p className="wf-setting-note">All current PDFs become one PDF, following the source order above. A single PDF passes through unchanged.</p>}
    {step.type === 'images' && <>{select('paper', 'Page size', { a4: 'A4', letter: 'US Letter', image: 'Match image · no borders' })}{s.paper !== 'image' && <>{select('orientation', 'Orientation', { auto: 'Auto · match each image', portrait: 'Portrait', landscape: 'Landscape' })}{select('margin', 'Margins', { 0: 'None', 18: 'Small · ¼ inch', 36: 'Medium · ½ inch' })}</>}<p className="wf-setting-note">Images keep their proportions and stay in source order. Existing PDFs pass through. Add Merge PDFs next to combine everything.</p></>}
    {step.type === 'rotate' && <>{select('angle', 'Rotate clockwise', { 90: '90° · right', 180: '180° · upside down', 270: '270° · left' })}{pages()}</>}
    {step.type === 'reorder' && <>{input('order', 'Page order', { placeholder: '3, 1-2, 4-' })}<label className="wf-check"><input type="checkbox" checked={s.keepRemaining} onChange={event => update({ keepRemaining: event.target.checked })} /> Keep unlisted pages at the end</label><p className="wf-setting-note">Page numbers refer to each PDF at this step. Use 3-1 to reverse a range or 2- to run to the end. Turn off “Keep unlisted pages” to extract only your selection.</p></>}
    {step.type === 'split' && <>{input('every', 'Pages per output file', { type: 'number', min: 1, max: 10000, step: 1 })}<p className="wf-setting-note">Each current PDF is split in order. The last file can contain fewer pages. Later steps run on every resulting file.</p></>}
    {step.type === 'compress' && <>{select('mode', 'Compression preset', { lossless: 'Original quality · lossless', balanced: 'Balanced · recommended', strong: 'Smallest size' })}<p className="wf-setting-note">Balanced and Smallest size reduce image detail. If optimization makes a PDF larger, its smaller input is kept.</p></>}
    {step.type === 'watermark' && <>{input('text', 'Watermark text', { maxLength: 500 })}{select('position', 'Position', { center: 'Center', 'top-center': 'Top center', 'bottom-center': 'Bottom center' })}{input('opacity', 'Opacity (%)', { type: 'number', min: 1, max: 100 })}{input('rotation', 'Angle (°)', { type: 'number', min: -180, max: 180 })}{input('fontSize', 'Text size (pt)', { type: 'number', min: 8, max: 144 })}{input('color', 'Text colour', { type: 'color' })}{pages()}</>}
    {step.type === 'numbers' && <>{select('format', 'Number format', { number: '1, 2, 3', page: 'Page 1', fraction: '1 / 10', full: 'Page 1 of 10', custom: 'Custom format' })}{s.format === 'custom' && <FormGroup label="Custom format"><input className="form-input" value={s.template ?? 'Page {number} of {total}'} onChange={event => update({ template: event.target.value })} placeholder="Page {number} of {total}" /></FormGroup>}{input('startAt', 'Start number', { type: 'number', min: 0, max: 999999999, step: 1 })}{select('position', 'Position', Object.fromEntries(Object.entries(positions).filter(([key]) => key !== 'center')))}{input('fontSize', 'Text size (pt)', { type: 'number', min: 6, max: 72 })}{pages()}<p className="wf-setting-note">Numbering restarts for each PDF. Place this step after Merge for one continuous sequence, or after Split to number each part separately.</p></>}
  </div>
}

export default function WorkflowBuilder() {
  const { showToast } = useApp()
  const [sources, setSources] = useState([])
  const [name, setName] = useState('My workflow')
  const [steps, setSteps] = useState(() => [makeWorkflowStep('compress')])
  const [saved, setSaved] = useState([])
  const [savedId, setSavedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [packing, setPacking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [runStates, setRunStates] = useState({})
  const [result, setResult] = useState(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [palette, setPalette] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())
  const operation = useRef(null)
  const importOperation = useRef(null)
  const archiveOperation = useRef(null)
  const configRef = useRef(null)
  const resultsRef = useRef(null)
  const alive = useRef(true)
  const refreshSaved = async () => { const values = await getWorkflows(); if (alive.current) setSaved(values.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))) }
  useEffect(() => {
    alive.current = true
    getWorkflows().then(values => { if (alive.current) setSaved(values.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))) }).catch(() => { if (alive.current) setError('Saved workflows could not be loaded. You can still build and run a workflow.') })
    return () => { alive.current = false; operation.current?.abort(); importOperation.current?.abort(); archiveOperation.current?.abort() }
  }, [])
  useEffect(() => { if (result) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [result])
  const locked = busy || loading || packing || saving
  const plan = planWorkflow(sources, steps)
  const enabledCount = steps.filter(step => step.enabled !== false).length
  const invalidate = () => { setResult(null); setRunStates({}); setError(''); setStatus(''); setProgress(0); setPreviewIndex(0) }
  const edit = fn => { if (locked) return; invalidate(); fn() }
  const updateStep = (id, changes) => edit(() => setSteps(current => current.map(step => step.id === id ? { ...step, ...changes } : step)))
  const move = (items, from, direction) => { const to = from + direction; if (to < 0 || to >= items.length) return items; const next = [...items]; [next[from], next[to]] = [next[to], next[from]]; return next }
  const choose = async files => {
    if (locked || importOperation.current || !files.length) return
    invalidate(); setLoading(true)
    const controller = new AbortController(); importOperation.current = controller
    const accepted = [], rejected = []
    try {
      for (const file of files) {
        if (controller.signal.aborted) return
        try { accepted.push(await readWorkflowSource(file, controller.signal)) }
        catch (failure) { if (failure.name === 'AbortError') return; rejected.push(`${file.name}: ${failure.message}`) }
      }
      if (!alive.current || controller.signal.aborted) return
      setSources(current => [...current, ...accepted])
      if (rejected.length) setError(rejected.join('\n'))
    } finally { if (importOperation.current === controller) { importOperation.current = null; if (alive.current) setLoading(false) } }
  }
  const addStep = type => edit(() => { setSteps(current => [...current, makeWorkflowStep(type)]); setPalette(false) })
  const preset = item => edit(() => { const next = item.types.map(makeWorkflowStep); setName(item.name); setSteps(next); setCollapsed(new Set(next.slice(1).map(step => step.id))); setSavedId(null); setPalette(false) })
  const saveConfig = async (asCopy = false) => {
    if (saving) return
    setError(''); setSaving(true)
    try {
      const config = workflowConfiguration(name, steps)
      const record = { ...config, id: asCopy ? crypto.randomUUID() : savedId || crypto.randomUUID(), savedAt: Date.now() }
      await saveWorkflow(record); await refreshSaved()
      if (alive.current) { setSavedId(record.id); showToast('Workflow saved on this device.', 'success') }
    } catch (failure) { if (alive.current) setError(failure.message || 'Could not save this workflow.') }
    finally { if (alive.current) setSaving(false) }
  }
  const loadConfig = config => {
    if (locked) return
    try { const normalized = workflowConfiguration(config.name, config.steps); edit(() => { setName(normalized.name); setSteps(normalized.steps); setCollapsed(new Set(normalized.steps.slice(1).map(step => step.id))); setSavedId(config.id || null); setPalette(false) }) }
    catch (failure) { setError(failure.message) }
  }
  const exportConfig = () => {
    try { downloadBlob(new Blob([JSON.stringify(workflowConfiguration(name, steps), null, 2)], { type: 'application/json' }), workflowFilename(name, 'json')) }
    catch (failure) { setError(failure.message) }
  }
  const importConfig = async file => {
    if (!file || locked) return
    try {
      if (file.size > 1000000) throw new Error('The workflow configuration is too large.')
      const config = parseWorkflowConfiguration(await file.text())
      if (alive.current) loadConfig(config)
    } catch (failure) { if (alive.current) setError(failure.message) }
  }
  const run = async () => {
    if (!plan.ready || locked || operation.current) return
    invalidate(); setBusy(true); setPalette(false)
    const controller = new AbortController(); operation.current = controller
    try {
      const output = await runPdfWorkflow(sources, steps, { signal: controller.signal, name,
        onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } },
        onStep: record => { if (operation.current === controller) setRunStates(current => ({ ...current, [record.id]: record })) },
      })
      if (operation.current !== controller || controller.signal.aborted) return
      setResult(output); setProgress(100); setStatus('Workflow complete. Review and download your files.')
      showToast('Workflow completed. Your files are ready to review.', 'success')
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'The workflow could not finish.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const cancel = () => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setProgress(0); setStatus('Workflow cancelled. Your original files are ready to use again.')
    setRunStates(current => Object.fromEntries(Object.entries(current).map(([key, record]) => [key, record.status === 'running' ? { ...record, status: 'cancelled' } : record])))
  }
  const downloadAll = async () => {
    if (!result || archiveOperation.current) return
    if (result.entries.length === 1) { downloadBlob(result.entries[0].file, result.entries[0].name); return }
    const controller = new AbortController(); archiveOperation.current = controller; setPacking(true); setError('')
    try {
      const blob = await createPdfArchive(result.entries, { signal: controller.signal })
      if (alive.current && !controller.signal.aborted) downloadBlob(blob, workflowFilename(name, 'zip'))
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP.') }
    finally { if (archiveOperation.current === controller) { archiveOperation.current = null; if (alive.current) setPacking(false) } }
  }

  return <ToolPage toolId="pdf-workflow"><div className="wf-workspace">
    <div className="wf-overview"><span><span className="wf-stage">01</span> Add source files</span><ArrowRight size={15} /><span><span className="wf-stage">02</span> Build your sequence</span><ArrowRight size={15} /><span><span className="wf-stage">03</span> Review & download</span><span className="wf-private"><ShieldCheck size={14} /> Files stay on your device</span></div>
    <section className="wf-presets"><div><h2>Start with a workflow</h2><p>Use a preset or build your own sequence below.</p></div><div className="wf-preset-list">{WORKFLOW_PRESETS.map(item => <button key={item.name} disabled={locked} onClick={() => preset(item)}><GitBranch size={17} /><span><strong>{item.name}</strong><small>{item.description}</small></span><ArrowRight size={15} /></button>)}</div></section>
    <div className="wf-main"><div className="wf-builder">
      <fieldset className="wf-fieldset tool-panel wf-sources" disabled={locked}>
        <div className="wf-section-heading"><span className="wf-stage">01</span><div><h2>Source files</h2><p>Operations use this order. Move files before merging.</p></div>{!!sources.length && <button className="btn btn-secondary btn-sm" onClick={() => edit(() => setSources([]))}>Clear files</button>}</div>
        <DropZone accept={['application/pdf', '.pdf', 'image/*']} multiple onFiles={choose} className={`wf-drop ${sources.length ? 'compact' : ''}`}><span className="wf-upload-icon"><Upload size={25} /></span><div className="drop-zone-title">{loading ? 'Checking source files…' : sources.length ? 'Add more source files' : 'Choose PDFs or images'}</div><div className="drop-zone-sub">Drop files here or click to browse</div></DropZone>
        {!!sources.length && <div className="wf-source-list">{sources.map((source, index) => <div className="wf-source" key={source.id}><span className="wf-file-number">{String(index + 1).padStart(2, '0')}</span>{source.kind === 'pdf' ? <FileText size={19} /> : <FileImage size={19} />}<div><strong title={source.file.name}>{source.file.name}</strong><small>{source.kind === 'image' ? `Image · ${source.width} × ${source.height}` : `${source.pageCount} ${source.pageCount === 1 ? 'page' : 'pages'}`} · {formatBytes(source.file.size)}</small></div><div className="wf-icon-actions"><button className="icon-btn" aria-label={`Move source ${index + 1} up`} disabled={!index} onClick={() => edit(() => setSources(current => move(current, index, -1)))}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`Move source ${index + 1} down`} disabled={index === sources.length - 1} onClick={() => edit(() => setSources(current => move(current, index, 1)))}><ArrowDown size={14} /></button><button className="icon-btn" aria-label={`Remove source ${index + 1}`} onClick={() => edit(() => setSources(current => current.filter(item => item.id !== source.id)))}><X size={14} /></button></div></div>)}</div>}
      </fieldset>

      <fieldset className="wf-fieldset tool-panel wf-sequence" disabled={locked}>
        <div className="wf-section-heading"><span className="wf-stage">02</span><div><h2>Build your sequence</h2><p>Each step receives the previous step’s output.</p></div></div>
        <div className="wf-name-row"><FormGroup label="Workflow name"><input className="form-input" value={name} maxLength={120} onChange={event => edit(() => setName(event.target.value))} /></FormGroup><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => saveConfig()}><Save size={14} />{saving ? 'Saving…' : savedId ? 'Save changes' : 'Save workflow'}</button>{savedId && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => saveConfig(true)}><Copy size={14} /> Save copy</button>}</div>
        <div className="wf-config-actions"><button onClick={() => configRef.current?.click()}><FolderOpen size={13} /> Import configuration</button><button onClick={exportConfig}><Download size={13} /> Export configuration</button><button onClick={() => edit(() => { setName('My workflow'); setSteps([makeWorkflowStep('compress')]); setSavedId(null); setPalette(false) })}><Plus size={13} /> New workflow</button></div>
        <input ref={configRef} type="file" accept="application/json,.json" hidden onChange={event => { importConfig(event.target.files[0]); event.target.value = '' }} />
        <div className="wf-steps">{steps.map((step, index) => {
          const row = plan.rows[index], record = runStates[step.id]
          return <section className={`wf-step ${step.enabled === false ? 'wf-disabled' : ''} ${row.error ? 'wf-invalid' : ''}`} key={step.id} aria-label={`Step ${index + 1}`}>
            <div className="wf-step-header"><span className="wf-step-number">{record?.status === 'done' ? <Check size={15} /> : index + 1}</span><label className="wf-operation-label"><span className="sr-only">Operation for step {index + 1}</span><select className="form-select" value={step.type} onChange={event => updateStep(step.id, normalizeWorkflowStep({ type: event.target.value, enabled: step.enabled }))}>{Object.entries(WORKFLOW_OPERATIONS).map(([value, op]) => <option value={value} key={value}>{op.label}</option>)}</select></label><label className="wf-enable"><input type="checkbox" checked={step.enabled !== false} aria-label={`Enable step ${index + 1}`} onChange={event => updateStep(step.id, { enabled: event.target.checked })} /><span>Enabled</span></label><button className="wf-settings-toggle" disabled={step.enabled === false} aria-label={`Settings for step ${index + 1}`} aria-expanded={!collapsed.has(step.id)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(step.id)) next.delete(step.id); else next.add(step.id); return next })}>Settings <ChevronDown size={12} /></button><div className="wf-icon-actions"><button className="icon-btn" aria-label={`Move step ${index + 1} up`} disabled={!index} onClick={() => edit(() => setSteps(current => move(current, index, -1)))}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => edit(() => setSteps(current => move(current, index, 1)))}><ArrowDown size={14} /></button><button className="icon-btn" aria-label={`Remove step ${index + 1}`} onClick={() => edit(() => setSteps(current => current.filter(item => item.id !== step.id)))}><Trash2 size={14} /></button></div></div>
            {step.enabled !== false && !collapsed.has(step.id) && <StepSettings step={step} update={changes => updateStep(step.id, { settings: { ...step.settings, ...changes, ...(step.type === 'numbers' && changes.format === 'custom' && !step.settings.template ? { template: 'Page {number} of {total}' } : {}) } })} />}
            <div className={`wf-step-foot ${record?.status || ''}`}>{row.error ? <span role="alert">{row.error}</span> : step.enabled === false ? 'Skipped · enable to include this step' : record?.status === 'running' ? 'Running…' : record?.status === 'error' ? record.error : record?.status === 'cancelled' ? 'Cancelled' : sources.length && !row.blocked ? <><span>{countLabel(row.input)}</span><ArrowRight size={12} /><span>{countLabel(row.output)}</span>{record?.status === 'done' && <CheckCircle2 size={13} />}</> : sources.length ? 'Waiting for an earlier step to be fixed' : WORKFLOW_OPERATIONS[step.type].description}</div>
          </section>
        })}</div>
        {!steps.length && <p className="wf-note">Add an operation to start your workflow.</p>}
        <button className="btn btn-secondary wf-add" disabled={steps.length >= 50} aria-expanded={palette} onClick={() => setPalette(!palette)}><Plus size={15} /> Add operation</button>
        {palette && <div className="wf-operation-palette" aria-label="Available operations">{Object.entries(WORKFLOW_OPERATIONS).map(([type, op]) => <button key={type} onClick={() => addStep(type)}><strong>{op.label}</strong><small>{op.description}</small></button>)}</div>}
      </fieldset>
      {!!saved.length && <details className="tool-panel wf-saved"><summary><Save size={15} /> Saved on this device <span>{saved.length}</span></summary><div>{saved.map(config => <div className="wf-saved-row" key={config.id}><button disabled={locked} onClick={() => loadConfig(config)}><strong>{config.name}</strong><small>{config.steps.length} steps</small></button><button className="icon-btn" disabled={locked} aria-label={`Delete saved workflow ${config.name}`} onClick={async () => { try { await deleteWorkflow(config.id); if (savedId === config.id) setSavedId(null); await refreshSaved() } catch (failure) { if (alive.current) setError(failure.message || 'Could not delete this workflow.') } }}><Trash2 size={14} /></button></div>)}</div></details>}
    </div>

    <aside className="wf-run-panel tool-panel">
      <div className="wf-section-heading"><span className="wf-stage">03</span><div><h2>Workflow plan</h2><p>{enabledCount} active {enabledCount === 1 ? 'step' : 'steps'}</p></div></div>
      <div className="wf-plan-source"><FileText size={17} /><span>{sources.length ? countLabel({ files: sources.length, pages: sources.reduce((sum, source) => sum + source.pageCount, 0), images: sources.filter(source => source.kind === 'image').length }) : 'Waiting for source files'}</span></div>
      <ol className="wf-plan-list">{steps.map((step, index) => <li key={step.id} className={`${step.enabled === false ? 'skipped' : ''} ${plan.rows[index].error ? 'invalid' : ''} ${runStates[step.id]?.status || ''}`}><span>{runStates[step.id]?.status === 'done' ? <Check size={12} /> : index + 1}</span><div><strong>{WORKFLOW_OPERATIONS[step.type].label}</strong><small>{step.enabled === false ? 'Skipped' : runStates[step.id]?.status === 'running' ? 'Running…' : plan.rows[index].error ? 'Check this step' : sources.length && !plan.rows[index].blocked ? countLabel(plan.rows[index].output) : 'Awaiting inputs'}</small></div></li>)}</ol>
      <div className="wf-output-summary"><span>Expected output</span><strong>{plan.ready ? `${plan.output.files} ${plan.output.files === 1 ? 'PDF' : 'PDFs'} · ${plan.output.pages} ${plan.output.pages === 1 ? 'page' : 'pages'}` : 'Complete your workflow'}</strong><small>{plan.ready && plan.output.files > 1 ? 'Download individually or together as a ZIP' : 'Preview the result before downloading'}</small></div>
      {!sources.length && <p className="wf-note">Add PDFs or images to see how your files move through the sequence.</p>}
      {!!plan.errors.length && <div className="wf-plan-errors" role="status">{plan.errors.map(message => <p key={message}>{message}</p>)}</div>}
      <button className="btn btn-primary btn-lg wf-run" disabled={!plan.ready || locked} onClick={run}><Play size={16} />{busy ? 'Running workflow…' : result ? 'Run again' : 'Run workflow'}</button>
      {busy && <><ProgressBar value={progress} label={status || 'Running workflow'} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel workflow</button></>}
      {!busy && status && <p className="wf-note" role="status">{status}</p>}
      <p className="wf-local-note"><ShieldCheck size={13} /> Runs locally. Source files are kept intact.</p>
    </aside></div>

    {error && <div className="wf-error" role="alert"><span>{error}</span><button className="icon-btn" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {result && <section ref={resultsRef} className="wf-results" aria-label="Workflow results">
      <div className="wf-result-heading"><div><span className="wf-success"><CheckCircle2 size={17} /> Workflow complete</span><h2>Your files are ready</h2><p>{result.entries.length} {result.entries.length === 1 ? 'PDF' : 'PDFs'} · {result.totalPages} {result.totalPages === 1 ? 'page' : 'pages'} · {formatBytes(result.totalBytes)}</p></div><button className="btn btn-primary" disabled={packing} onClick={downloadAll}>{result.entries.length > 1 ? <Archive size={16} /> : <Download size={16} />}{packing ? 'Preparing ZIP…' : result.entries.length > 1 ? 'Download all as ZIP' : 'Download PDF'}</button></div>
      <div className="wf-result-grid"><div className="tool-panel wf-result-files">{result.entries.map((entry, index) => <div className={`wf-result-file ${previewIndex === index ? 'selected' : ''}`} key={entry.id}><button className="wf-result-select" aria-label={`Preview output ${index + 1}`} aria-pressed={previewIndex === index} onClick={() => setPreviewIndex(index)}><FileText size={18} /><span><strong>{entry.name}</strong><small>{entry.pageCount} {entry.pageCount === 1 ? 'page' : 'pages'} · {formatBytes(entry.file.size)}</small></span></button><button className="icon-btn" aria-label={`Download output ${index + 1}`} onClick={() => downloadBlob(entry.file, entry.name)}><Download size={15} /></button></div>)}{result.entries[previewIndex].warnings.map(warning => <p className="wf-note" key={warning}>{warning}</p>)}</div><DocumentPdfPreview blob={result.entries[previewIndex].file} heading="Output preview" readyLabel="This is the file you will download" /></div>
    </section>}
  </div></ToolPage>
}
