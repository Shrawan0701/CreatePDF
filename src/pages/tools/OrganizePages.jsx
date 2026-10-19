import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, Download, Eye, FileText, GripVertical, Grid3x3, LoaderCircle, Redo2, RotateCcw, RotateCw, Trash2, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, Modal, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfjsLib, getPdfLib, loadPdfBytes } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'
import { PdfPageThumbnail as PageImage } from '../../components/PdfPageThumbnail'
import './OrganizePages.css'

const emptyHistory = () => ({ past: [], present: [], future: [] })
const newId = () => crypto.randomUUID()

export default function OrganizePages() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [pdf, setPdf] = useState(null)
  const [history, setHistory] = useState(emptyHistory), [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false), [processing, setProcessing] = useState(false), [progress, setProgress] = useState(0)
  const [error, setError] = useState(''), [draggedId, setDraggedId] = useState(null), [dropId, setDropId] = useState(null), [previewId, setPreviewId] = useState(null)
  const session = useRef(null), input = useRef(null), anchor = useRef(null)
  const pages = history.present, locked = loading || processing
  const active = new Set(pages.filter(page => selected.has(page.id)).map(page => page.id))
  const previewIndex = pages.findIndex(page => page.id === previewId), preview = pages[previewIndex]
  useEffect(() => () => { session.current?.task?.destroy().catch(() => {}); session.current = null }, [])

  const commit = transform => {
    if (locked) return
    setHistory(current => {
      const next = transform(current.present)
      if (next === current.present) return current
      return { past: [...current.past.slice(-39), current.present], present: next, future: [] }
    })
  }
  const undo = () => {
    if (locked || !history.past.length) return
    setHistory(current => current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1), future: [current.present, ...current.future] } : current)
    setSelected(new Set()); setPreviewId(null)
  }
  const redo = () => {
    if (locked || !history.future.length) return
    setHistory(current => current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current)
    setSelected(new Set()); setPreviewId(null)
  }
  const reset = () => {
    session.current?.task?.destroy().catch(() => {}); session.current = null
    setFile(null); setPdf(null); setHistory(emptyHistory()); setSelected(new Set()); setLoading(false); setProcessing(false); setProgress(0); setError(''); setPreviewId(null); setDraggedId(null); setDropId(null); anchor.current = null
  }
  const handleFile = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reset()
    const current = { task: null, bytes: null }; session.current = current
    setFile(next); setLoading(true)
    try {
      const [pdfjs, bytes] = await Promise.all([getPdfjsLib(), loadPdfBytes(next)])
      if (session.current !== current) return
      current.bytes = bytes
      current.task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false })
      const document = await current.task.promise
      if (session.current !== current) return
      if (!document.numPages) throw new Error('This PDF has no pages.')
      const items = Array.from({ length: document.numPages }, (_, index) => ({ num: index + 1, rotation: 0, id: newId() }))
      setPdf(document); setHistory({ past: [], present: items, future: [] }); setSelected(new Set([items[0].id])); anchor.current = items[0].id
    } catch (failure) {
      if (session.current === current) {
        setError(/password|encrypt/i.test(failure.message || '') ? 'Unlock this PDF with Remove Password, then add it here.' : 'Could not open this PDF. Choose a valid, undamaged file.')
        current.task?.destroy().catch(() => {})
      }
    } finally { if (session.current === current) setLoading(false) }
  }
  const toggle = (id, shift = false) => {
    if (locked) return
    if (shift && anchor.current) {
      const first = pages.findIndex(page => page.id === anchor.current), last = pages.findIndex(page => page.id === id)
      if (first >= 0 && last >= 0) { setSelected(previous => new Set([...previous, ...pages.slice(Math.min(first, last), Math.max(first, last) + 1).map(page => page.id)])); return }
    }
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
    anchor.current = id
  }
  const rotate = (ids, degrees) => commit(current => current.map(page => ids.has(page.id) ? { ...page, rotation: (page.rotation + degrees + 360) % 360 } : page))
  const remove = ids => {
    if (!ids.size || locked) return
    commit(current => current.filter(page => !ids.has(page.id)))
    setSelected(previous => new Set([...previous].filter(id => !ids.has(id))))
    if (ids.has(previewId)) setPreviewId(null)
  }
  const duplicate = ids => {
    if (!ids.size || locked) return
    const copies = new Map([...ids].map(id => [id, newId()]))
    commit(current => current.flatMap(page => copies.has(page.id) ? [page, { ...page, id: copies.get(page.id) }] : [page]))
    setSelected(new Set(copies.values()))
  }
  const move = (ids, direction) => commit(current => {
    const next = [...current]
    for (let index = direction < 0 ? 1 : next.length - 2; direction < 0 ? index < next.length : index >= 0; index -= direction) {
      const adjacent = index + direction
      if (ids.has(next[index].id) && !ids.has(next[adjacent].id)) [next[index], next[adjacent]] = [next[adjacent], next[index]]
    }
    return next.every((page, index) => page === current[index]) ? current : next
  })
  const reorder = targetId => {
    if (!draggedId || draggedId === targetId || locked) { setDraggedId(null); setDropId(null); return }
    commit(current => {
      const from = current.findIndex(page => page.id === draggedId), to = current.findIndex(page => page.id === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current], [item] = next.splice(from, 1)
      next.splice(to, 0, item); return next
    })
    setDraggedId(null); setDropId(null)
  }
  const handleExport = async () => {
    const current = session.current
    if (!current?.bytes || !pages.length || locked) return
    setProcessing(true); setProgress(0); setError('')
    try {
      if (pages.length === pdf.numPages && pages.every((page, index) => page.num === index + 1 && page.rotation === 0)) {
        downloadBlob(file, `${file.name.replace(/\.pdf$/i, '')}-organized.pdf`)
        setProgress(100); showToast('PDF downloaded.', 'success'); return
      }
      const { PDFDocument, degrees } = await getPdfLib()
      const source = await PDFDocument.load(current.bytes, { updateMetadata: false }), output = await PDFDocument.create()
      for (const [index, page] of pages.entries()) {
        if (session.current !== current) return
        const [copied] = await output.copyPages(source, [page.num - 1])
        copied.setRotation(degrees((copied.getRotation().angle + page.rotation + 360) % 360))
        output.addPage(copied); setProgress(Math.round((index + 1) / pages.length * 90))
        if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
      const bytes = await output.save({ useObjectStreams: true })
      if (session.current !== current) return
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${file.name.replace(/\.pdf$/i, '')}-organized.pdf`)
      setProgress(100); showToast('Organized PDF downloaded.', 'success')
    } catch (failure) { if (session.current === current) setError(failure.message || 'Could not save this PDF.') }
    finally { if (session.current === current) setProcessing(false) }
  }
  const canMove = direction => pages.some((page, index) => active.has(page.id) && pages[index + direction] && !active.has(pages[index + direction].id))

  return <ToolPage toolId="organize-pages"><div className="organize-workspace" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
  }}>
    <input ref={input} type="file" accept="application/pdf,.pdf" className="organize-file-input" onChange={event => { handleFile(Array.from(event.target.files)); event.target.value = '' }} />
    {!file ? <div className="tool-panel organize-upload"><DropZone onFiles={handleFile} accept={['application/pdf', '.pdf']}><div className="drop-zone-icon"><Grid3x3 size={28} /></div><div className="drop-zone-title">Choose a PDF</div><div className="drop-zone-sub">Drop it here or click to browse</div></DropZone></div> : <>
      <div className="organize-file-bar"><FileText size={18} /><strong title={file.name}>{file.name}</strong><span>{pdf ? `${pages.length} pages` : loading ? 'Opening…' : 'Could not open'}</span><button className="btn btn-secondary btn-sm" disabled={processing} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={processing} onClick={reset} title="Start over" aria-label="Start over"><X size={16} /></button></div>
      <div className="organize-toolbar" role="toolbar" aria-label="Page actions">
        <div className="organize-selection"><button className="btn btn-secondary btn-sm" disabled={locked || !pages.length} onClick={() => setSelected(active.size === pages.length ? new Set() : new Set(pages.map(page => page.id)))}>{active.size && active.size === pages.length ? 'Deselect all' : 'Select all'}</button><span role="status">{active.size ? `${active.size} selected` : 'Select pages'}</span>{active.size > 0 && <button className="organize-clear" disabled={locked} onClick={() => setSelected(new Set())}>Clear</button>}</div>
        <div className="organize-bulk-actions"><button className="btn btn-secondary btn-sm" disabled={locked || !active.size} onClick={() => rotate(active, -90)}><RotateCcw size={15} /> Rotate left</button><button className="btn btn-secondary btn-sm" disabled={locked || !active.size} onClick={() => rotate(active, 90)}><RotateCw size={15} /> Rotate right</button><button className="btn btn-secondary btn-sm" disabled={locked || !canMove(-1)} onClick={() => move(active, -1)}><ArrowLeft size={15} /> Move earlier</button><button className="btn btn-secondary btn-sm" disabled={locked || !canMove(1)} onClick={() => move(active, 1)}><ArrowRight size={15} /> Move later</button><button className="btn btn-secondary btn-sm" disabled={locked || !active.size} onClick={() => duplicate(active)}><Copy size={15} /> Duplicate</button><button className="btn btn-secondary btn-sm organize-delete" disabled={locked || !active.size} onClick={() => remove(active)}><Trash2 size={15} /> Delete</button></div>
        <div className="organize-history"><button className="icon-btn" disabled={locked || !history.past.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={17} /></button><button className="icon-btn" disabled={locked || !history.future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={17} /></button></div>
        <button className="btn btn-primary organize-download" disabled={locked || !pages.length} onClick={handleExport}>{processing ? <LoaderCircle size={16} className="organize-spin" /> : <Download size={16} />}{processing ? 'Saving…' : 'Download PDF'}</button>
      </div>
      {processing && <div className="organize-progress"><ProgressBar value={progress} label="Saving PDF" /></div>}
      {loading ? <div className="tool-panel organize-loading" role="status"><LoaderCircle size={23} className="organize-spin" /> Opening PDF…</div> : pdf && <div className="tool-panel organize-board">
        <div className="organize-board-heading"><span>{pages.length} {pages.length === 1 ? 'page' : 'pages'}</span><span>Drag to reorder</span></div>
        <div className="organize-grid">{pages.map((page, index) => {
          const one = new Set([page.id]), chosen = active.has(page.id)
          return <article key={page.id} className={`organize-card${chosen ? ' is-selected' : ''}${draggedId === page.id ? ' is-dragging' : ''}${dropId === page.id && draggedId !== page.id ? ' is-drop-target' : ''}`} onDragOver={event => { if (draggedId && !locked) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropId(page.id) } }} onDrop={event => { event.preventDefault(); reorder(page.id) }}>
            <div className="organize-card-header"><label className="organize-checkbox"><input type="checkbox" checked={chosen} disabled={locked} onChange={event => toggle(page.id, event.nativeEvent.shiftKey)} aria-label={`Select page ${index + 1}`} /><span aria-hidden="true">{chosen && <Check size={12} />}</span></label><span>Page {index + 1}</span><button className="icon-btn organize-grip" draggable={!locked} disabled={locked} aria-label={`Drag page ${index + 1} to reorder`} title="Drag to reorder" onDragStart={event => { event.dataTransfer.setData('text/plain', page.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(page.id) }} onDragEnd={() => { setDraggedId(null); setDropId(null) }}><GripVertical size={16} /></button></div>
            <button className="organize-thumbnail" disabled={locked} aria-label={`${chosen ? 'Deselect' : 'Select'} page ${index + 1}`} aria-pressed={chosen} draggable={!locked} onClick={event => toggle(page.id, event.shiftKey)} onDragStart={event => { event.dataTransfer.setData('text/plain', page.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(page.id) }} onDragEnd={() => { setDraggedId(null); setDropId(null) }}><PageImage pdf={pdf} page={page} /></button>
            <div className="organize-page-actions" aria-label={`Actions for page ${index + 1}`}><button className="icon-btn" disabled={locked} onClick={() => rotate(one, -90)} title="Rotate left" aria-label={`Rotate page ${index + 1} left`}><RotateCcw size={15} /></button><button className="icon-btn" disabled={locked} onClick={() => rotate(one, 90)} title="Rotate right" aria-label={`Rotate page ${index + 1} right`}><RotateCw size={15} /></button><button className="icon-btn" disabled={locked} onClick={() => duplicate(one)} title="Duplicate" aria-label={`Duplicate page ${index + 1}`}><Copy size={15} /></button><button className="icon-btn" disabled={locked} onClick={() => setPreviewId(page.id)} title="Preview" aria-label={`Preview page ${index + 1}`}><Eye size={15} /></button><button className="icon-btn organize-delete" disabled={locked} onClick={() => remove(one)} title="Delete" aria-label={`Delete page ${index + 1}`}><Trash2 size={15} /></button></div>
            <div className="organize-page-move"><button disabled={locked || index === 0} onClick={() => move(one, -1)} aria-label={`Move page ${index + 1} earlier`}><ArrowLeft size={12} /> Earlier</button><span title={`Original page ${page.num}`}>Source {page.num}</span><button disabled={locked || index === pages.length - 1} onClick={() => move(one, 1)} aria-label={`Move page ${index + 1} later`}>Later <ArrowRight size={12} /></button></div>
          </article>
        })}</div>
        {!pages.length && <div className="organize-empty"><FileText size={28} /><p>No pages left</p><button className="btn btn-secondary" onClick={undo} disabled={locked || !history.past.length}><Undo2 size={15} /> Undo delete</button></div>}
      </div>}
    </>}
    {error && <p className="organize-error" role="alert">{error}</p>}
    <Modal open={!!preview} onClose={() => setPreviewId(null)} title={`Page ${previewIndex + 1} of ${pages.length}`} maxWidth={800} footer={<div className="organize-preview-footer"><button className="btn btn-secondary btn-sm" disabled={previewIndex <= 0} onClick={() => setPreviewId(pages[previewIndex - 1].id)}><ArrowLeft size={14} /> Previous</button><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => rotate(new Set([previewId]), 90)}><RotateCw size={14} /> Rotate</button><button className="btn btn-secondary btn-sm" disabled={previewIndex + 1 >= pages.length} onClick={() => setPreviewId(pages[previewIndex + 1].id)}>Next <ArrowRight size={14} /></button></div>}>{preview && pdf && <PageImage pdf={pdf} page={preview} large />}</Modal>
  </div></ToolPage>
}
