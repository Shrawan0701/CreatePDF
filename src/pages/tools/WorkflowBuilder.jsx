import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Play, Plus, Save, Trash2 } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, ProgressBar, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { addPageNumbers, addWatermarkToPdf, compressPdf, createZipFromBlobs, getPdfLib, imagesToPdf, loadPdfBytes, mergePdfs, rotatePdfPages } from '../../services/pdfEngine'
import { deleteWorkflow, getWorkflows, saveWorkflow } from '../../services/storage'

const operationDefaults = {
  merge: '', images: '', rotate: '90', reorder: '1-', compress: 'balanced', watermark: 'CONFIDENTIAL', numbers: 'Page ',
}

const operationLabels = {
  merge: 'Merge PDFs', images: 'Convert images to PDF', rotate: 'Rotate pages', reorder: 'Reorder pages', compress: 'Compress', watermark: 'Watermark', numbers: 'Page numbers',
}

export default function WorkflowBuilder() {
  const { showToast } = useApp()
  const [files, setFiles] = useState([])
  const [name, setName] = useState('My workflow')
  const [steps, setSteps] = useState([{ id: generateId(), type: 'compress', value: 'balanced' }])
  const [saved, setSaved] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const refreshSaved = () => getWorkflows().then(setSaved)
  useEffect(() => { refreshSaved() }, [])

  const addStep = () => setSteps((current) => [...current, { id: generateId(), type: 'watermark', value: operationDefaults.watermark }])
  const updateStep = (id, updates) => setSteps((current) => current.map((step) => step.id === id ? { ...step, ...updates } : step))
  const moveStep = (index, direction) => setSteps((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next })
  const saveConfig = async () => { const workflow = { id: generateId(), name: name.trim() || 'Workflow', steps, savedAt: Date.now() }; await saveWorkflow(workflow); await refreshSaved(); showToast('Workflow saved locally.', 'success') }
  const loadConfig = (workflow) => { setName(workflow.name); setSteps(workflow.steps.map((step) => ({ ...step, id: generateId() }))) }

  const reorderPdf = async (file, order) => {
    const { PDFDocument } = await getPdfLib()
    const source = await PDFDocument.load(await loadPdfBytes(file))
    const pages = []
    for (const token of order.replace(/-$/, `-${source.getPageCount()}`).split(',').map((value) => value.trim()).filter(Boolean)) {
      const [rawStart, rawEnd] = token.split('-').map(Number)
      const end = Number.isFinite(rawEnd) ? rawEnd : rawStart
      if (!Number.isInteger(rawStart) || !Number.isInteger(end)) continue
      const direction = rawStart <= end ? 1 : -1
      for (let page = rawStart; direction > 0 ? page <= end : page >= end; page += direction) if (page >= 1 && page <= source.getPageCount() && !pages.includes(page)) pages.push(page)
    }
    if (!pages.length) throw new Error('Reorder requires a valid page order.')
    const output = await PDFDocument.create()
    ;(await output.copyPages(source, pages.map((page) => page - 1))).forEach((page) => output.addPage(page))
    return new Blob([await output.save()], { type: 'application/pdf' })
  }

  const run = async () => {
    if (!files.length || !steps.length) return
    setBusy(true); setProgress(0)
    try {
      let current = files.filter((file) => file.type === 'application/pdf')
      const images = files.filter((file) => file.type.startsWith('image/'))
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]
        if (step.type === 'images') {
          if (!images.length) throw new Error('The workflow has no image source files.')
          current.push(new File([await imagesToPdf(images)], 'images.pdf', { type: 'application/pdf' }))
        } else if (step.type === 'merge') {
          if (current.length < 2) throw new Error('Merge requires at least two PDF inputs.')
          current = [new File([await mergePdfs(current)], 'merged.pdf', { type: 'application/pdf' })]
        } else {
          if (!current.length) throw new Error(`${operationLabels[step.type]} requires a PDF input.`)
          current = await Promise.all(current.map(async (source, sourceIndex) => {
            let output
            if (step.type === 'rotate') output = await rotatePdfPages(source, Object.fromEntries(Array.from({ length: 10000 }, (_, pageIndex) => [pageIndex, Number(step.value || 90)])))
            if (step.type === 'reorder') output = await reorderPdf(source, step.value)
            if (step.type === 'compress') output = await compressPdf(source, { mode: step.value || 'balanced' })
            if (step.type === 'watermark') output = await addWatermarkToPdf(source, step.value || 'CONFIDENTIAL')
            if (step.type === 'numbers') output = await addPageNumbers(source, { prefix: step.value || '' })
            return new File([output], source.name || `output-${sourceIndex + 1}.pdf`, { type: 'application/pdf' })
          }))
        }
        setProgress(Math.round((index + 1) / steps.length * 100))
      }
      if (current.length === 1) downloadBlob(current[0], `workflow-${current[0].name}`)
      else downloadBlob(await createZipFromBlobs(current.map((blob, index) => ({ blob, name: `workflow-output-${index + 1}.pdf` }))), 'workflow-results.zip')
      showToast('Workflow completed.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }

  return <ToolPage toolId="pdf-workflow"><div className="tool-panel"><DropZone accept={['application/pdf', 'image/*']} multiple onFiles={(incoming) => setFiles((current) => [...current, ...incoming])}><FileText size={30} /><div className="drop-zone-title">Choose PDFs or images</div><div className="drop-zone-sub">Add every source needed by the workflow.</div></DropZone>{files.map((file, index) => <FileItem key={`${file.name}-${index}`} file={file} onRemove={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))} />)}</div><div className="tool-panel"><div className="workflow-heading"><input className="form-input" value={name} onChange={(event) => setName(event.target.value)} /><button className="btn btn-secondary" onClick={saveConfig}><Save size={15} /> Save configuration</button></div>{steps.map((step, index) => <div className="workflow-row" key={step.id}><span>{index + 1}</span><select className="form-select" value={step.type} onChange={(event) => updateStep(step.id, { type: event.target.value, value: operationDefaults[event.target.value] })}>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="form-input" value={step.value} disabled={step.type === 'merge' || step.type === 'images'} onChange={(event) => updateStep(step.id, { value: event.target.value })} placeholder={step.type === 'reorder' ? '3,1,2,4-8' : 'Operation setting'} /><button className="icon-btn" disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={14} /></button><button className="icon-btn" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={14} /></button><button className="icon-btn" onClick={() => setSteps(steps.filter((item) => item.id !== step.id))}><Trash2 size={14} /></button></div>)}<button className="btn btn-secondary" onClick={addStep}><Plus size={15} /> Add operation</button></div>{saved.length > 0 && <div className="tool-panel"><div className="tool-panel-title">Saved workflows</div>{saved.map((workflow) => <div className="saved-workflow" key={workflow.id}><button className="btn btn-secondary" onClick={() => loadConfig(workflow)}>{workflow.name}</button><span>{workflow.steps.length} steps</span><button className="icon-btn" onClick={async () => { await deleteWorkflow(workflow.id); refreshSaved() }}><Trash2 size={14} /></button></div>)}</div>}{busy && <ProgressBar value={progress} label="Running workflow" />}<button className="btn btn-primary btn-lg" disabled={!files.length || !steps.length || busy} onClick={run}><Play size={17} /> Run workflow</button></ToolPage>
}
