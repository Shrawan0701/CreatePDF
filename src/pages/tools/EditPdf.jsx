import { useEffect, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronLeft, ChevronRight, Copy, Download, Edit3, Eye, Highlighter, ImagePlus, Italic, Layers, LoaderCircle, Minus, MousePointer2, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, Save, Square, Trash2, Type, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { PdfPageThumbnail } from '../../components/PdfPageThumbnail'
import { DropZone, Modal, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfjsLib, loadPdfBytes } from '../../services/pdfEngine'
import { createEditedPdf, readEditorImage } from '../../services/pdfEditor'
import { getDocument as getSavedDocument, saveDocument } from '../../services/storage'
import { useApp } from '../../context/AppContext'
import './EditPdf.css'

const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
const emptyHistory = () => ({ past: [], items: [], future: [] })
const defaults = { fontSize: 18, fontFamily: 'Helvetica', color: '#172b27', bold: false, italic: false, align: 'left', strokeWidth: 2, opacity: 1, filled: false }
const shapeDefaults = { rect: { color: '#172b27', strokeWidth: 2, opacity: 1, filled: false }, line: { color: '#172b27', strokeWidth: 2, opacity: 1 }, highlight: { color: '#f5ce36', opacity: .35, filled: true } }
const tools = [['select', MousePointer2, 'Select'], ['text', Type, 'Text'], ['edit', Edit3, 'Edit text'], ['highlight', Highlighter, 'Highlight'], ['rect', Square, 'Rectangle'], ['line', Minus, 'Line']]
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

async function disposePdfTask(task) {
  try { await task?.destroy() } catch { /* Closing a cancelled load must not interrupt the editor. */ }
}

function IconButton({ icon: Icon, label, ...props }) {
  return <button type="button" className="ed-icon" title={label} aria-label={label} {...props}><Icon size={17} /></button>
}

export default function EditPdf() {
  const { showToast, recordRecentFile } = useApp()
  const [source, setSource] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [page, setPage] = useState(1), [pageInput, setPageInput] = useState('1'), [zoom, setZoom] = useState(1), [width, setWidth] = useState(720)
  const [view, setView] = useState({ width: 600, height: 780, scale: 1, page: 0, textItems: [] })
  const [rendering, setRendering] = useState(false), [retry, setRetry] = useState(0), [showPages, setShowPages] = useState(true)
  const [edits, setEdits] = useState(emptyHistory), [selectedId, setSelectedId] = useState(null), [editingId, setEditingId] = useState(null)
  const [tool, setTool] = useState('select'), [config, setConfig] = useState(defaults), [savedItems, setSavedItems] = useState(null)
  const [shapeConfig, setShapeConfig] = useState(shapeDefaults)
  const [busy, setBusy] = useState(false), [imageLoading, setImageLoading] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [preview, setPreview] = useState(null)
  const canvas = useRef(null), stage = useRef(null), scroller = useRef(null), pdfInput = useRef(null), imageInput = useRef(null)
  const reading = useRef(null), operation = useRef(null), interaction = useRef(null), typingSnapshot = useRef(null), cached = useRef(null)
  const sourceRef = useRef(source), editsRef = useRef(edits), dirtyRef = useRef(false), loadRef = useRef(null), imageJob = useRef(null)
  sourceRef.current = source; editsRef.current = edits
  const dirty = edits.items.length > 0 && edits.items !== savedItems
  dirtyRef.current = dirty
  const selected = edits.items.find(item => item.id === selectedId)
  const objectType = selected?.type || tool
  const properties = selected || shapeConfig[tool] || config
  const locked = loading || busy || imageLoading
  const ready = source && view.source === source && view.page === page && view.zoom === zoom && view.containerWidth === width && !rendering
  const textProperties = selected ? ['text', 'replace'].includes(selected.type) : ['select', 'text', 'edit'].includes(tool)
  const shapeProperties = ['highlight', 'rect', 'line'].includes(objectType)
  const hasReplacement = edits.items.some(item => item.type === 'replace')

  const commit = updater => {
    cached.current = null
    setEdits(previous => {
      const items = typeof updater === 'function' ? updater(previous.items) : updater
      if (items === previous.items) return previous
      return { past: [...previous.past.slice(-49), previous.items], items, future: [] }
    })
  }
  const transient = updater => { cached.current = null; setEdits(previous => ({ ...previous, items: updater(previous.items) })) }
  const finishTyping = () => {
    const snapshot = typingSnapshot.current
    typingSnapshot.current = null
    if (snapshot && snapshot !== editsRef.current.items) setEdits(previous => ({ past: [...previous.past.slice(-49), snapshot], items: previous.items, future: [] }))
    setEditingId(null)
  }
  const undo = () => {
    finishTyping(); interaction.current = null
    setEdits(previous => previous.past.length ? { past: previous.past.slice(0, -1), items: previous.past.at(-1), future: [previous.items, ...previous.future] } : previous)
    setSelectedId(null)
  }
  const redo = () => {
    finishTyping(); interaction.current = null
    setEdits(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.items], items: previous.future[0], future: previous.future.slice(1) } : previous)
    setSelectedId(null)
  }
  const selectTool = value => { finishTyping(); setSelectedId(null); setTool(value) }
  const changePage = value => {
    if (locked || !source) return
    finishTyping(); interaction.current = null; setSelectedId(null); setError('')
    setPage(clamp(Math.round(Number(value) || 1), 1, source.pdf.numPages))
    scroller.current?.scrollTo({ top: 0, left: 0 })
  }
  useEffect(() => { setPageInput(String(page)) }, [page])

  const loadFile = async incoming => {
    if (operation.current) return
    const file = incoming[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Choose a PDF file.'); return }
    if (dirtyRef.current && !window.confirm('Open another PDF and discard unsaved edits?')) return
    disposePdfTask(reading.current?.task)
    const request = {}; reading.current = request
    setLoading(true); setError('')
    try {
      const pdfjs = await getPdfjsLib(), data = await loadPdfBytes(file)
      if (reading.current !== request) return
      request.task = pdfjs.getDocument({ data })
      const pdf = await request.task.promise
      if (reading.current !== request) { await disposePdfTask(request.task); return }
      imageJob.current = null; setImageLoading(false); cached.current = null; interaction.current = null; typingSnapshot.current = null
      setSource({ file, pdf, loadingTask: request.task }); setPage(1); setPageInput('1'); setZoom(1); setEdits(emptyHistory()); setSavedItems(null)
      setSelectedId(null); setEditingId(null); setTool('select'); setConfig(defaults); setShapeConfig(shapeDefaults); setPreview(null)
    } catch (failure) {
      disposePdfTask(request.task)
      if (reading.current === request) setError(failure.name === 'PasswordException' ? 'Unlock this password-protected PDF before editing it.' : failure.message || 'Could not open this PDF.')
    } finally { if (reading.current === request) { reading.current = null; setLoading(false) } }
  }
  loadRef.current = loadFile
  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get('document')
    if (!documentId) return
    let cancelled = false
    getSavedDocument(documentId).then(saved => {
      if (cancelled) return
      if (!saved?.blob) throw new Error('This saved document is no longer available on this device.')
      return loadRef.current([new File([saved.blob], saved.name, { type: 'application/pdf' })])
    }).catch(failure => { if (!cancelled) setError(failure.message) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => () => { disposePdfTask(source?.loadingTask || source?.pdf?.loadingTask) }, [source])
  useEffect(() => () => { disposePdfTask(reading.current?.task); reading.current = null; operation.current?.abort(); imageJob.current = null }, [])
  useEffect(() => {
    const beforeUnload = event => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const resize = () => {
      const styles = getComputedStyle(element)
      const next = Math.max(160, Math.floor(element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) - 2))
      setWidth(previous => previous === next ? previous : next)
    }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [source, showPages])

  useEffect(() => {
    if (!source) return
    let cancelled = false, task
    setRendering(true)
    const draw = async () => {
      const pdfPage = await source.pdf.getPage(page)
      if (cancelled) return
      const native = pdfPage.getViewport({ scale: 1 })
      const scale = Math.min(1100, width) / native.width * zoom
      const viewport = pdfPage.getViewport({ scale })
      const density = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
      const buffer = window.document.createElement('canvas')
      try {
        buffer.width = Math.max(1, Math.ceil(viewport.width * density)); buffer.height = Math.max(1, Math.ceil(viewport.height * density))
        task = pdfPage.render({ canvasContext: buffer.getContext('2d'), viewport, transform: [density, 0, 0, density, 0, 0], background: '#ffffff' })
        await task.promise
        const content = await pdfPage.getTextContent(), pdfjs = await getPdfjsLib()
        if (cancelled || !canvas.current) return
        const textItems = content.items.flatMap((item, index) => {
          if (!item.str?.trim()) return []
          const transform = pdfjs.Util.transform(native.transform, item.transform)
          if (Math.abs(transform[1]) > .1 || transform[0] <= 0) return []
          const fontSize = Math.max(1, Math.hypot(transform[2], transform[3]))
          const style = content.styles[item.fontName] || {}, ascent = style.ascent ?? .85, descent = Math.abs(style.descent ?? -.2)
          const x = clamp(transform[4] / native.width, 0, 1), y = clamp((transform[5] - fontSize * ascent) / native.height, 0, 1)
          const textWidth = item.width * Math.hypot(native.transform[0], native.transform[1])
          return [{ id: `${page}-${index}`, text: item.str, x, y, width: Math.min(1 - x, Math.max(2, textWidth) / native.width), height: Math.min(1 - y, fontSize * (ascent + descent) / native.height), fontSize, fontFamily: /mono/i.test(style.fontFamily) ? 'Courier' : /sans/i.test(style.fontFamily) ? 'Helvetica' : /serif/i.test(style.fontFamily) ? 'Times' : 'Helvetica' }]
        })
        const target = canvas.current
        target.width = buffer.width; target.height = buffer.height
        target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`
        target.getContext('2d').drawImage(buffer, 0, 0)
        setView({ source, page, zoom, containerWidth: width, width: viewport.width, height: viewport.height, scale, nativeWidth: native.width, nativeHeight: native.height, textItems })
      } finally { buffer.width = buffer.height = 0 }
    }
    draw().catch(failure => { if (!cancelled && failure.name !== 'RenderingCancelledException') setError(`Could not render page ${page}: ${failure.message}`) }).finally(() => { if (!cancelled) setRendering(false) })
    return () => { cancelled = true; task?.cancel() }
  }, [source, page, width, zoom, retry])

  const point = event => {
    const bounds = stage.current.getBoundingClientRect()
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) }
  }
  const addText = event => {
    const position = point(event), size = config.fontSize
    const item = { ...config, id: makeId(), type: 'text', page, x: Math.min(position.x, .75), y: Math.min(position.y, Math.max(0, 1 - size * 1.5 / view.nativeHeight)), width: .25, height: Math.min(1, Math.max(.04, size * 1.5 / view.nativeHeight)), text: '' }
    commit(items => [...items, item]); setSelectedId(item.id); setEditingId(item.id); setTool('select')
  }
  const editOriginal = item => {
    if (!ready || locked) return
    const paddingX = 1.5 / view.nativeWidth, paddingY = 1.5 / view.nativeHeight
    const x = Math.max(0, item.x - paddingX), y = Math.max(0, item.y - paddingY)
    const sourceRegion = { x, y, width: Math.min(1 - x, item.width + paddingX * 2), height: Math.min(1 - y, item.height + paddingY * 2) }
    const target = canvas.current
    const pixel = target.getContext('2d').getImageData(clamp(Math.floor(x * target.width), 0, target.width - 1), clamp(Math.floor(y * target.height), 0, target.height - 1), 1, 1).data
    const backgroundColor = `#${[...pixel].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`
    const replacement = { ...defaults, ...item, id: makeId(), sourceId: item.id, type: 'replace', page, width: Math.min(1 - item.x, Math.max(item.width, .05)), height: Math.min(1 - item.y, Math.max(item.height, item.fontSize * 1.3 / view.nativeHeight)), sourceRegion, backgroundColor, original: item.text }
    commit(items => [...items.filter(entry => entry.sourceId !== item.id), replacement]); setSelectedId(replacement.id); setEditingId(replacement.id); setTool('select')
  }
  const stageDown = event => {
    if (event.button !== 0 || !ready || locked) return
    if (tool === 'select' || tool === 'edit') { finishTyping(); setSelectedId(null); return }
    event.preventDefault()
    if (tool === 'text') { addText(event); return }
    const start = point(event)
    const item = { ...shapeConfig[tool], id: makeId(), type: tool, page, x: Math.min(start.x, .95), y: Math.min(start.y, .96), width: Math.max(.003, Math.min(.23, 1 - start.x)), height: Math.max(.002, Math.min(tool === 'line' ? .002 : tool === 'highlight' ? .03 : .12, 1 - start.y)) }
    interaction.current = { id: item.id, mode: 'create', start, original: item, snapshot: edits.items }
    event.currentTarget.setPointerCapture(event.pointerId)
    transient(items => [...items, item]); setSelectedId(item.id)
  }
  const startInteraction = (event, item, mode) => {
    if (event.button !== 0 || locked || !ready) return
    event.stopPropagation()
    if (!['select', 'edit'].includes(tool)) return
    event.preventDefault(); finishTyping(); setSelectedId(item.id)
    interaction.current = { id: item.id, mode, start: point(event), original: item, snapshot: edits.items, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveInteraction = event => {
    const active = interaction.current
    if (!active) return
    const next = point(event), dx = next.x - active.start.x, dy = next.y - active.start.y, original = active.original
    if (!active.moved && Math.hypot(dx * view.width, dy * view.height) < 3) return
    active.moved = true
    transient(items => items.map(item => {
      if (item.id !== active.id) return item
      if (active.mode === 'create') return { ...item, x: Math.min(active.start.x, next.x), y: Math.min(active.start.y, next.y), width: Math.max(.003, Math.abs(dx)), height: Math.max(.002, Math.abs(dy)), reverse: dx * dy < 0 }
      if (active.mode === 'move') return { ...item, x: clamp(original.x + dx, 0, Math.max(0, 1 - original.width)), y: clamp(original.y + dy, 0, Math.max(0, 1 - original.height)) }
      let itemWidth = clamp(original.width + dx, .015, 1 - original.x), itemHeight = clamp(original.height + dy, .008, 1 - original.y)
      if (item.type === 'image' && item.lockAspect !== false) {
        const ratio = original.width / original.height
        const preferredWidth = Math.abs(dx * view.width) >= Math.abs(dy * view.height) ? original.width + dx : (original.height + dy) * ratio
        itemWidth = clamp(preferredWidth, .015, Math.min(1 - original.x, (1 - original.y) * ratio)); itemHeight = itemWidth / ratio
      }
      return { ...item, width: itemWidth, height: itemHeight }
    }))
  }
  const endInteraction = (cancelled = false) => {
    const active = interaction.current
    if (!active) return
    interaction.current = null
    if (cancelled) { transient(() => active.snapshot); return }
    if (active.moved || active.mode === 'create') setEdits(previous => ({ ...previous, past: [...previous.past.slice(-49), active.snapshot], future: [] }))
    if (active.mode === 'create') setTool('select')
  }
  const changeProperty = updates => {
    if (shapeConfig[objectType]) setShapeConfig(previous => ({ ...previous, [objectType]: { ...previous[objectType], ...updates } }))
    else setConfig(previous => ({ ...previous, ...updates }))
    if (selectedId) commit(items => items.map(item => {
      if (item.id !== selectedId) return item
      const next = { ...item, ...updates }
      if (updates.fontSize && ['text', 'replace'].includes(item.type)) next.height = Math.min(1 - item.y, Math.max(item.height, updates.fontSize * 1.4 * Math.max(1, item.text.split('\n').length) / view.nativeHeight))
      return next
    }))
  }
  const removeSelected = () => {
    if (!selectedId) return
    typingSnapshot.current = null; setEditingId(null)
    commit(items => items.filter(item => item.id !== selectedId)); setSelectedId(null)
  }
  const duplicate = () => {
    if (!selected) return
    finishTyping()
    const next = { ...selected, id: makeId(), x: Math.min(1 - selected.width, selected.x + .025), y: Math.min(1 - selected.height, selected.y + .025), type: selected.type === 'replace' ? 'text' : selected.type, sourceId: undefined, sourceRegion: undefined }
    commit(items => [...items, next]); setSelectedId(next.id)
  }
  const insertImage = async incoming => {
    if (!incoming[0] || locked || !ready) return
    const request = { source, page }; imageJob.current = request
    setImageLoading(true); setError('')
    try {
      const image = await readEditorImage(incoming[0])
      if (imageJob.current !== request || sourceRef.current !== source) return
      const width = Math.min(.45, .5 * view.nativeHeight * image.aspect / view.nativeWidth), height = width * view.nativeWidth / (image.aspect * view.nativeHeight)
      const item = { ...image, id: makeId(), page, type: 'image', x: (1 - width) / 2, y: (1 - height) / 2, width, height, lockAspect: true }
      commit(items => [...items, item]); setSelectedId(item.id); setEditingId(null); setTool('select')
    } catch (failure) { if (imageJob.current === request) setError(failure.message || 'Could not add this image.') }
    finally { if (imageJob.current === request) { imageJob.current = null; setImageLoading(false) } }
  }

  useEffect(() => {
    const keyboard = event => {
      if (locked || !source || preview) return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) {
        if (event.key === 'Escape') { event.target.blur(); finishTyping() }
        return
      }
      const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey
      if (command && key === 's') { event.preventDefault(); exportPdf(event.shiftKey ? 'download' : 'save'); return }
      if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (command && key === 'y') { event.preventDefault(); redo(); return }
      if (command && key === 'd' && selected) { event.preventDefault(); duplicate(); return }
      if (command) return
      if (key === 'enter' && selected && ['text', 'replace'].includes(selected.type) && event.target.closest?.('.ed-object')) { event.preventDefault(); setEditingId(selected.id); setTool('select'); return }
      if ((key === 'delete' || key === 'backspace') && selectedId) { event.preventDefault(); removeSelected() }
      if (key === 'escape') { finishTyping(); setSelectedId(null); setTool('select') }
      if (selected && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        changeProperty({ x: clamp(selected.x + (key === 'arrowright' ? step : key === 'arrowleft' ? -step : 0) / view.nativeWidth, 0, 1 - selected.width), y: clamp(selected.y + (key === 'arrowdown' ? step : key === 'arrowup' ? -step : 0) / view.nativeHeight, 0, 1 - selected.height) })
      }
      const shortcuts = { v: 'select', t: 'text', e: 'edit', h: 'highlight', r: 'rect', l: 'line' }
      if (shortcuts[key]) { event.preventDefault(); selectTool(shortcuts[key]) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  const exportPdf = async action => {
    if (!source || locked || interaction.current) return
    finishTyping()
    const snapshot = editsRef.current.items, controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing PDF…')
    try {
      const blob = cached.current?.items === snapshot && cached.current?.source === source ? cached.current.blob : await createEditedPdf(source.file, source.pdf, snapshot, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      cached.current = { source, items: snapshot, blob }
      const name = `edited-${source.file.name}`
      if (action === 'preview') setPreview(blob)
      else if (action === 'save') {
        const id = makeId()
        await saveDocument(id, name, blob)
        await recordRecentFile({ id, documentId: id, name, size: blob.size, type: 'application/pdf' })
        if (operation.current === controller) { setSavedItems(snapshot); showToast('Edited PDF saved on this device.', 'success') }
      } else { downloadBlob(blob, name); setSavedItems(snapshot); showToast('Edited PDF downloaded.', 'success') }
    } catch (failure) { if (operation.current === controller && failure.name !== 'AbortError' && failure.name !== 'RenderingCancelledException') setError(failure.message || 'Could not export this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const close = () => {
    if (locked || (dirty && !window.confirm('Close this PDF and discard unsaved edits?'))) return
    cached.current = null; typingSnapshot.current = null; interaction.current = null
    setSource(null); setEdits(emptyHistory()); setSelectedId(null); setEditingId(null); setError(''); setPreview(null)
  }

  return <ToolPage toolId="edit-pdf"><div className="edit-workspace">
    <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden disabled={locked} onChange={event => { loadFile(Array.from(event.target.files)); event.target.value = '' }} />
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden disabled={locked} onChange={event => { insertImage(Array.from(event.target.files)); event.target.value = '' }} />
    {!source ? <div className="tool-panel ed-upload"><DropZone onFiles={loadFile} accept={['application/pdf', '.pdf']}><Edit3 size={30} /><div className="drop-zone-title">Choose a PDF to edit</div><div className="drop-zone-sub">Text, images, highlights and shapes</div></DropZone></div> : <>
      <div className="ed-document-bar"><div className="ed-file"><strong title={source.file.name}>{source.file.name}</strong><span>{source.pdf.numPages} pages{edits.items.length ? ` · ${edits.items.length} edits` : ''}{dirty ? ' · Unsaved' : ''}</span></div><div className="ed-document-actions">
        <IconButton icon={Upload} label="Change PDF" disabled={locked} onClick={() => pdfInput.current?.click()} />
        <button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => exportPdf('preview')}><Eye size={15} /><span>Preview</span></button>
        <button className="btn btn-secondary btn-sm ed-save" disabled={locked} onClick={() => exportPdf('save')}><Save size={15} /><span>Save locally</span></button>
        <button className="btn btn-primary btn-sm editor-download" disabled={locked} onClick={() => exportPdf('download')}><Download size={16} /> Download PDF</button>
        <IconButton icon={X} label="Close PDF" disabled={locked} onClick={close} />
      </div></div>

      <div className="ed-toolbar" role="toolbar" aria-label="PDF editing tools"><div className="ed-tools">{tools.map(([value, Icon, label]) => <button key={value} disabled={locked} aria-pressed={tool === value} onClick={() => selectTool(value)} title={label}><Icon size={17} /><span>{label}</span></button>)}<button disabled={locked || !ready} onClick={() => { finishTyping(); imageInput.current?.click() }}><ImagePlus size={17} /><span>Image</span></button></div><div className="ed-history">
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={locked || !edits.past.length} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={locked || !edits.future.length} onClick={redo} />
        <IconButton icon={RotateCcw} label="Reset all edits" disabled={locked || !edits.items.length} onClick={() => { finishTyping(); commit([]); setSelectedId(null) }} />
      </div></div>

      <fieldset className="ed-properties" disabled={locked}>
        {textProperties && <><select className="form-select" aria-label="Font" value={properties.fontFamily || config.fontFamily} onChange={event => changeProperty({ fontFamily: event.target.value })}><option value="Helvetica">Sans serif</option><option value="Times">Serif</option><option value="Courier">Monospace</option></select><label className="ed-size">Size<input aria-label="Font size" type="number" min={6} max={144} value={properties.fontSize} onChange={event => { if (event.target.value) changeProperty({ fontSize: clamp(Number(event.target.value), 6, 144) }) }} /></label><IconButton icon={Bold} label="Bold" aria-pressed={!!properties.bold} onClick={() => changeProperty({ bold: !properties.bold })} /><IconButton icon={Italic} label="Italic" aria-pressed={!!properties.italic} onClick={() => changeProperty({ italic: !properties.italic })} /><span className="ed-separator" />{[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([align, Icon]) => <IconButton key={align} icon={Icon} label={`Align ${align}`} aria-pressed={properties.align === align} onClick={() => changeProperty({ align })} />)}</>}
        {selected?.type !== 'image' && <label className="ed-color">Color<input aria-label="Object color" type="color" value={properties.color} onChange={event => changeProperty({ color: event.target.value })} /></label>}
        {shapeProperties && <><label className="ed-size">Opacity<input aria-label="Opacity percent" type="number" min={0} max={100} value={Math.round((properties.opacity ?? 1) * 100)} onChange={event => changeProperty({ opacity: clamp(Number(event.target.value), 0, 100) / 100 })} /></label>{objectType !== 'highlight' && <label className="ed-size">Stroke<input aria-label="Stroke width" type="number" min={.5} max={20} step={.5} value={properties.strokeWidth} onChange={event => { if (event.target.value) changeProperty({ strokeWidth: clamp(Number(event.target.value), .5, 20) }) }} /></label>}{objectType === 'rect' && <label className="ed-check"><input type="checkbox" checked={!!properties.filled} onChange={event => changeProperty({ filled: event.target.checked })} /> Fill</label>}</>}
        {selected?.type === 'image' && <label className="ed-check"><input type="checkbox" checked={selected.lockAspect !== false} onChange={event => changeProperty({ lockAspect: event.target.checked })} /> Keep proportions</label>}
        <div className="ed-object-actions"><IconButton icon={Copy} label="Duplicate object (Ctrl+D)" disabled={!selected} onClick={duplicate} /><IconButton icon={Layers} label="Bring object to front" disabled={!selected} onClick={() => commit(items => [...items.filter(item => item.id !== selectedId), selected])} /><IconButton icon={Trash2} label="Delete selected object" disabled={!selected} onClick={removeSelected} /></div>
      </fieldset>

      <div className="ed-pagebar"><IconButton icon={showPages ? PanelLeftClose : PanelLeftOpen} label={showPages ? 'Hide page thumbnails' : 'Show page thumbnails'} onClick={() => setShowPages(value => !value)} /><div className="ed-page-navigation"><IconButton icon={ChevronLeft} label="Previous page" disabled={locked || page === 1} onClick={() => changePage(page - 1)} /><label>Page <input aria-label="Page number" inputMode="numeric" value={pageInput} disabled={locked} onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))} onBlur={() => { changePage(pageInput); setPageInput(String(clamp(Number(pageInput) || 1, 1, source.pdf.numPages))) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /> of {source.pdf.numPages}</label><IconButton icon={ChevronRight} label="Next page" disabled={locked || page === source.pdf.numPages} onClick={() => changePage(page + 1)} /></div><div className="ed-zoom"><IconButton icon={ZoomOut} label="Zoom out" disabled={locked || zoom <= .5} onClick={() => setZoom(value => Math.max(.5, +(value - .25).toFixed(2)))} /><button className="ed-fit" disabled={locked} onClick={() => setZoom(1)} title="Fit width">{Math.round(zoom * 100)}%</button><IconButton icon={ZoomIn} label="Zoom in" disabled={locked || zoom >= 2.5} onClick={() => setZoom(value => Math.min(2.5, +(value + .25).toFixed(2)))} /></div></div>

      <div className={`ed-body${showPages ? ' with-pages' : ''}`}>
        {showPages && <nav className="ed-pages" aria-label="PDF pages">{Array.from({ length: source.pdf.numPages }, (_, index) => { const num = index + 1, count = edits.items.filter(item => item.page === num).length; return <button key={num} className={page === num ? 'active' : ''} aria-label={`Page ${num}${count ? `, ${count} edits` : ''}`} aria-current={page === num ? 'page' : undefined} disabled={locked} onClick={() => changePage(num)}><PdfPageThumbnail pdf={source.pdf} page={{ num, rotation: 0 }} /><span>{num}{count > 0 && <b>{count}</b>}</span></button> })}</nav>}
        <div className="ed-canvas-area"><div ref={scroller} className="ed-scroll"><div ref={stage} className={`ed-stage tool-${tool}`} style={{ width: view.width, height: view.height }} onPointerDown={stageDown} onPointerMove={moveInteraction} onPointerUp={() => endInteraction()} onPointerCancel={() => endInteraction(true)}>
          <canvas ref={canvas} className="pdf-editor-canvas" role="img" aria-label={`PDF page ${page}`} />
          {ready && <>{tool === 'edit' && view.textItems.filter(item => !edits.items.some(overlay => overlay.sourceId === item.id)).map(item => <button className="ed-original-text" key={item.id} aria-label={`Edit text: ${item.text}`} title={item.text} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} onPointerDown={event => event.stopPropagation()} onClick={() => editOriginal(item)} />)}
          {edits.items.filter(item => item.page === page && item.type === 'replace').map(item => <div key={`mask-${item.id}`} className="ed-mask" style={{ left: `${item.sourceRegion.x * 100}%`, top: `${item.sourceRegion.y * 100}%`, width: `${item.sourceRegion.width * 100}%`, height: `${item.sourceRegion.height * 100}%`, background: item.backgroundColor }} />)}
          {edits.items.filter(item => item.page === page).map(item => <div key={item.id} className={`ed-object ed-${item.type}${selectedId === item.id ? ' selected' : ''}`} tabIndex={0} role="group" aria-label={`${item.type === 'replace' ? 'Replacement text' : item.type} object`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%`, color: item.color, fontSize: item.fontSize ? item.fontSize * view.scale : undefined, fontFamily: item.fontFamily === 'Times' ? '"Times New Roman", serif' : item.fontFamily === 'Courier' ? '"Courier New", monospace' : 'Arial, sans-serif', fontWeight: item.bold ? 700 : 400, fontStyle: item.italic ? 'italic' : 'normal', textAlign: item.align || 'left' }} onFocus={() => setSelectedId(item.id)} onPointerDown={event => startInteraction(event, item, 'move')} onDoubleClick={event => { event.stopPropagation(); if (['text', 'replace'].includes(item.type)) { setSelectedId(item.id); setEditingId(item.id); setTool('select') } }}>
            {['text', 'replace'].includes(item.type) && (editingId === item.id ? <textarea aria-label="Text content" autoFocus placeholder="Type here" value={item.text} onFocus={() => { typingSnapshot.current = editsRef.current.items }} onPointerDown={event => event.stopPropagation()} onChange={event => { const text = event.target.value, height = Math.min(1 - item.y, Math.max(item.height, event.target.scrollHeight / view.height)); transient(items => items.map(entry => entry.id === item.id ? { ...entry, text, height } : entry)) }} onBlur={() => { finishTyping(); if (!editsRef.current.items.find(entry => entry.id === item.id)?.text.trim() && item.type === 'text') commit(items => items.filter(entry => entry.id !== item.id)) }} /> : <span className="ed-text-content">{item.text}</span>)}
            {item.type === 'image' && <img src={item.dataUrl} alt={item.label || 'Inserted image'} draggable={false} />}
            {['rect', 'highlight', 'line'].includes(item.type) && <svg className="ed-shape" width="100%" height="100%" aria-hidden="true" overflow="visible">{item.type === 'line' ? <line x1="0" y1={item.reverse ? '100%' : '0'} x2="100%" y2={item.reverse ? '0' : '100%'} stroke={item.color} strokeWidth={(item.strokeWidth || 2) * view.scale} opacity={item.opacity} /> : <rect width="100%" height="100%" fill={item.filled ? item.color : 'none'} stroke={item.type === 'highlight' ? 'none' : item.color} strokeWidth={(item.strokeWidth || 2) * view.scale} opacity={item.opacity} />}</svg>}
            {selectedId === item.id && <button className="ed-resize" aria-label="Resize object" onPointerDown={event => startInteraction(event, item, 'resize')} />}
          </div>)}</>}
        </div></div>{(!ready || locked) && <div className="ed-rendering" role="status"><LoaderCircle size={19} className="ed-spin" />{loading ? 'Opening PDF…' : imageLoading ? 'Adding image…' : busy ? 'Preparing PDF…' : rendering ? 'Loading page…' : <button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Reload page</button>}</div>}</div>
      </div>
      <div className="ed-status"><span>{tool === 'text' ? 'Click the page to add text.' : tool === 'edit' ? ready && !view.textItems.length ? 'No selectable text on this page.' : 'Click original text to replace it.' : ['rect', 'line', 'highlight'].includes(tool) ? 'Drag on the page to draw.' : selected ? 'Drag to move · corner to resize' : 'Select a tool or an added object.'}</span>{(tool === 'edit' || hasReplacement) && <span>Text replacement flattens the background on affected pages.</span>}</div>
    </>}
    {loading && !source && <p className="ed-loading" role="status"><LoaderCircle size={18} className="ed-spin" /> Opening PDF…</p>}
    {busy && <div className="ed-export-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={() => { operation.current?.abort(); operation.current = null; setBusy(false) }}><X size={14} /> Cancel</button></div>}
    {error && <p className="ed-error" role="alert">{error}</p>}
    <Modal open={!!preview} onClose={() => setPreview(null)} title="Edited PDF" maxWidth={1000} footer={<button className="btn btn-primary" onClick={() => { downloadBlob(preview, `edited-${source.file.name}`); setSavedItems(edits.items) }}><Download size={16} /> Download PDF</button>}><DocumentPdfPreview blob={preview} initialPage={page} heading="Exported PDF" /></Modal>
  </div></ToolPage>
}
