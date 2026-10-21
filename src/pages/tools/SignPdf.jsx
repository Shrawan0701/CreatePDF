import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Download, Eye, FileSignature, ImagePlus, LoaderCircle, Plus, Redo2, RotateCcw, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DocumentPdfPreview } from '../../components/DocumentPdfPreview'
import { PdfPageThumbnail } from '../../components/PdfPageThumbnail'
import { SignatureDrawPad } from '../../components/SignatureDrawPad'
import { SignPdfCanvas } from '../../components/SignPdfCanvas'
import { DropZone, Modal, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfjsLib, loadPdfBytes } from '../../services/pdfEngine'
import { createEditedPdf } from '../../services/pdfEditor'
import { createDrawnSignature, createTypedSignature, importSignatureImage, SIGNATURE_FONTS, signatureTargetPages } from '../../services/pdfSigning'
import { useApp } from '../../context/AppContext'
import './SignPdf.css'

const id = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const emptyHistory = () => ({ past: [], items: [], future: [] })
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const dispose = async task => { try { await task?.destroy() } catch { /* A cancelled document must not interrupt cleanup. */ } }

function IconButton({ icon: Icon, label, ...props }) {
  return <button type="button" className="sign-icon" title={label} aria-label={label} {...props}><Icon size={17} /></button>
}

export default function SignPdf() {
  const { showToast } = useApp()
  const [source, setSource] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [page, setPage] = useState(1), [pageInput, setPageInput] = useState('1'), [zoom, setZoom] = useState(1), [geometry, setGeometry] = useState(null)
  const [mode, setMode] = useState('draw'), [strokes, setStrokes] = useState([]), [ink, setInk] = useState('#172b27'), [penWidth, setPenWidth] = useState(6)
  const [name, setName] = useState(''), [font, setFont] = useState('script'), [imageFile, setImageFile] = useState(null), [image, setImage] = useState(null)
  const [removeBackground, setRemoveBackground] = useState(true), [imageBusy, setImageBusy] = useState(false), [imageError, setImageError] = useState('')
  const [assets, setAssets] = useState([]), [history, setHistory] = useState(emptyHistory), [selectedId, setSelectedId] = useState(null), [copyRange, setCopyRange] = useState(''), [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [preview, setPreview] = useState(null), [savedItems, setSavedItems] = useState(null)
  const pdfInput = useRef(null), imageInput = useRef(null), reading = useRef(null), operation = useRef(null), cache = useRef(null), dirtyRef = useRef(false)
  const selected = history.items.find(item => item.id === selectedId)
  const locked = loading || busy || imageBusy || !!preview
  const ready = geometry?.source === source && geometry?.page === page
  const dirty = history.items.length > 0 && history.items !== savedItems; dirtyRef.current = dirty
  const draft = useMemo(() => mode === 'draw' ? createDrawnSignature(strokes, { color: ink, width: penWidth }) : mode === 'type' ? createTypedSignature(name, font, ink) : image, [mode, strokes, ink, penWidth, name, font, image])
  const pageCounts = useMemo(() => { const counts = new Map(); for (const item of history.items) counts.set(item.page, (counts.get(item.page) || 0) + 1); return counts }, [history.items])

  useEffect(() => () => { dispose(source?.task) }, [source])
  useEffect(() => () => { dispose(reading.current?.task); reading.current = null; operation.current?.abort() }, [])
  useEffect(() => {
    const warn = event => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => { setPageInput(String(page)) }, [page])
  useEffect(() => {
    if (!imageFile) { setImage(null); return }
    const controller = new AbortController()
    setImageBusy(true); setImageError('')
    importSignatureImage(imageFile, removeBackground, controller.signal).then(result => {
      if (!controller.signal.aborted) setImage({ ...result, label: imageFile.name })
    }).catch(failure => {
      if (!controller.signal.aborted) { setImage(null); setImageError(failure.message || 'Could not open this image.') }
    }).finally(() => { if (!controller.signal.aborted) setImageBusy(false) })
    return () => controller.abort()
  }, [imageFile, removeBackground])

  const commit = updater => {
    cache.current = null
    setHistory(previous => ({ past: [...previous.past.slice(-49), previous.items], items: typeof updater === 'function' ? updater(previous.items) : updater, future: [] }))
  }
  const transient = updater => { cache.current = null; setHistory(previous => ({ ...previous, items: updater(previous.items) })) }
  const finishGesture = snapshot => setHistory(previous => ({ ...previous, past: [...previous.past.slice(-49), snapshot], future: [] }))
  const undo = () => { setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), items: previous.past.at(-1), future: [previous.items, ...previous.future] } : previous); setSelectedId(null) }
  const redo = () => { setHistory(previous => previous.future.length ? { past: [...previous.past.slice(-49), previous.items], items: previous.future[0], future: previous.future.slice(1) } : previous); setSelectedId(null) }
  const changePage = value => { if (!locked && source) { setPage(clamp(Math.round(Number(value) || page), 1, source.pdf.numPages)); setSelectedId(null) } }
  const loadFile = async incoming => {
    if (operation.current) return
    const file = incoming[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Choose a PDF file.'); return }
    if (dirtyRef.current && !window.confirm('Open another PDF and discard unsaved placements?')) return
    dispose(reading.current?.task)
    const request = {}; reading.current = request
    setLoading(true); setError('')
    try {
      const pdfjs = await getPdfjsLib(), data = await loadPdfBytes(file)
      if (reading.current !== request) return
      request.task = pdfjs.getDocument({ data })
      const pdf = await request.task.promise
      if (reading.current !== request) { await dispose(request.task); return }
      setSource({ file, pdf, task: request.task }); setHistory(emptyHistory()); setSelectedId(null); setSavedItems(null)
      setPage(1); setPageInput('1'); setZoom(1); setGeometry(null); setPreview(null); setCopyRange(''); cache.current = null
    } catch (failure) {
      dispose(request.task)
      if (reading.current === request) setError(failure.name === 'PasswordException' ? 'Unlock this password-protected PDF before signing it.' : failure.message || 'Could not open this PDF.')
    } finally { if (reading.current === request) { reading.current = null; setLoading(false) } }
  }
  const close = () => {
    if (locked || (dirty && !window.confirm('Close this PDF and discard unsaved placements?'))) return
    setSource(null); setHistory(emptyHistory()); setSelectedId(null); setGeometry(null); setPreview(null); setError(''); cache.current = null
  }
  const remember = (asset, label) => {
    const known = assets.find(entry => entry.dataUrl === asset.dataUrl)
    if (known) return known
    const added = { ...asset, id: id(), label: label || `Signature ${assets.length + 1}` }
    setAssets(previous => [...previous, added]); return added
  }
  const place = (asset, replace = false) => {
    if (!asset || !source || !ready || locked) return
    const center = geometry.center(), ratio = geometry.nativeWidth / (asset.aspect * geometry.nativeHeight)
    const width = Math.min(asset.kind === 'date' ? .18 : .28, .18 / ratio), height = width * ratio
    const key = id()
    const item = { ...asset, id: key, familyId: key, type: 'image', page, width, height, x: clamp(center.x - width / 2, 0, 1 - width), y: clamp(center.y - height / 2, 0, 1 - height) }
    if (replace && selected) {
      const fit = Math.min(selected.width, .95 / ratio), itemHeight = fit * ratio
      Object.assign(item, { id: selected.id, familyId: selected.familyId, width: fit, height: itemHeight, x: Math.min(selected.x, 1 - fit), y: Math.min(selected.y, 1 - itemHeight) })
      commit(items => items.map(entry => entry.id === selected.id ? item : entry))
    } else commit(items => [...items, item])
    setSelectedId(item.id); setError('')
  }
  const addDraft = replace => { if (draft && ready && !locked) place(remember(draft, mode === 'type' ? name.trim() : mode === 'image' ? imageFile?.name : undefined), replace) }
  const duplicate = () => {
    if (!selected || locked) return
    const key = id(), next = { ...selected, id: key, familyId: key, x: Math.min(1 - selected.width, selected.x + .025), y: Math.min(1 - selected.height, selected.y + .025) }
    commit(items => [...items, next]); setSelectedId(key)
  }
  const remove = () => { if (selected && !locked) { commit(items => items.filter(item => item.id !== selected.id)); setSelectedId(null) } }
  const repeat = async () => {
    if (!selected || !source || !ready || locked || operation.current) return
    let targets
    try { targets = signatureTargetPages(copyRange, source.pdf.numPages).filter(value => value !== selected.page) }
    catch (failure) { setError(failure.message); return }
    if (!targets.length) { setError('Choose at least one other page.'); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Copying signature…')
    try {
      const original = (await source.pdf.getPage(selected.page)).getViewport({ scale: 1 }), clones = [], familyId = selected.familyId || selected.id
      for (let index = 0; index < targets.length; index++) {
        if (controller.signal.aborted) return
        const target = (await source.pdf.getPage(targets[index])).getViewport({ scale: 1 })
        let width = selected.width * original.width / target.width, height = selected.height * original.height / target.height
        const fit = Math.min(1, .95 / width, .95 / height); width *= fit; height *= fit
        clones.push({ ...selected, id: id(), familyId, page: targets[index], width, height, x: Math.min(selected.x, 1 - width), y: Math.min(selected.y, 1 - height) })
        setProgress(Math.round((index + 1) / targets.length * 100))
        if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (controller.signal.aborted || operation.current !== controller) return
      const pages = new Set(targets)
      commit(items => [...items.filter(item => !(item.familyId === familyId && pages.has(item.page))), ...clones])
      showToast(`Signature copied to ${targets.length} ${targets.length === 1 ? 'page' : 'pages'}.`, 'success')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not copy this signature.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const addDate = () => {
    if (!date || locked || !ready) return
    const [year, month, day] = date.split('-'), label = `${day}/${month}/${year}`
    place({ ...createTypedSignature(label, 'formal', ink), kind: 'date', label })
  }

  const exportPdf = async action => {
    if (!source || !history.items.length || locked || operation.current) return
    const controller = new AbortController(), snapshot = history.items; operation.current = controller
    setBusy(true); setError(''); setProgress(0); setStatus('Preparing signed PDF…')
    try {
      const blob = cache.current?.source === source && cache.current?.items === snapshot ? cache.current.blob : await createEditedPdf(source.file, source.pdf, snapshot, { signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      cache.current = { source, items: snapshot, blob }
      if (action === 'preview') setPreview({ blob, items: snapshot })
      else { downloadBlob(blob, `signed-${source.file.name}`); setSavedItems(snapshot); showToast('Signed PDF downloaded.', 'success') }
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not sign this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }

  useEffect(() => {
    const keydown = event => {
      if (!source || locked || event.target.closest?.('input, textarea, select, .sign-ink-pad, [contenteditable="true"]')) return
      const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey
      if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (command && key === 'y') { event.preventDefault(); redo(); return }
      if (command && key === 'd' && selected) { event.preventDefault(); duplicate(); return }
      if (command && key === 's') { event.preventDefault(); exportPdf('download'); return }
      if (command) return
      if ((key === 'delete' || key === 'backspace') && selected) { event.preventDefault(); remove() }
      if (key === 'escape') setSelectedId(null)
      if (selected && ready && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault(); const amount = event.shiftKey ? 10 : 1
        const x = clamp(selected.x + (key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0) / geometry.nativeWidth, 0, 1 - selected.width)
        const y = clamp(selected.y + (key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0) / geometry.nativeHeight, 0, 1 - selected.height)
        commit(items => items.map(item => item.id === selected.id ? { ...item, x, y } : item))
      }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
  })

  return <ToolPage toolId="sign-pdf"><div className="sign-workspace">
    <input ref={pdfInput} hidden type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => { loadFile(Array.from(event.target.files)); event.target.value = '' }} />
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={locked} onChange={event => { if (event.target.files[0]) setImageFile(event.target.files[0]); event.target.value = '' }} />
    {!source ? <div className="tool-panel sign-upload"><DropZone onFiles={loadFile} accept={['application/pdf', '.pdf']}><FileSignature size={30} /><div className="drop-zone-title">Choose a PDF to sign</div><div className="drop-zone-sub">Drop it here or click to browse</div></DropZone></div> : <>
      <div className="sign-document-bar"><div className="sign-file"><strong title={source.file.name}>{source.file.name}</strong><span>{source.pdf.numPages} pages{history.items.length ? ` · ${history.items.length} placed` : ''}{dirty ? ' · Unsaved' : ''}</span></div><div className="sign-document-actions"><IconButton icon={Upload} label="Change PDF" disabled={locked} onClick={() => pdfInput.current?.click()} /><button className="btn btn-secondary btn-sm" disabled={locked || !history.items.length} onClick={() => exportPdf('preview')}><Eye size={15} /> Preview</button><button className="btn btn-primary btn-sm" disabled={locked || !history.items.length} onClick={() => exportPdf('download')}><Download size={16} /> Download PDF</button><IconButton icon={X} label="Close PDF" disabled={locked} onClick={close} /></div></div>
      <div className="sign-layout"><aside className="tool-panel sign-builder">
        <h2>Signature</h2><div className="sign-modes" role="group" aria-label="Signature method">{[['draw', 'Draw'], ['type', 'Type'], ['image', 'Image']].map(([value, label]) => <button key={value} disabled={locked} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        {mode === 'draw' && <SignatureDrawPad strokes={strokes} onChange={setStrokes} color={ink} width={penWidth} disabled={locked} />}
        {mode === 'type' && <div className="sign-type"><input className="form-input" aria-label="Your signature name" autoComplete="off" value={name} maxLength={120} disabled={locked} onChange={event => setName(event.target.value)} placeholder="Your name" /><div className="sign-fonts" role="group" aria-label="Signature style">{Object.entries(SIGNATURE_FONTS).map(([value, settings]) => <button key={value} disabled={locked} aria-pressed={font === value} style={{ fontFamily: settings.font, fontStyle: settings.italic ? 'italic' : 'normal' }} onClick={() => setFont(value)}>{settings.label}</button>)}</div><div className="sign-draft-preview">{draft && <img src={draft.dataUrl} alt="Typed signature preview" />}</div></div>}
        {mode === 'image' && <><div className="sign-image-input">{image ? <><div className="sign-draft-preview"><img src={image.dataUrl} alt="Signature image preview" /></div><button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => imageInput.current?.click()}><Upload size={13} /> Change image</button></> : <DropZone accept={['image/png', 'image/jpeg', 'image/webp', '.png', '.jpg', '.jpeg', '.webp']} onFiles={files => { if (!locked && files[0]) setImageFile(files[0]) }}><ImagePlus size={23} /><span>Choose signature image</span></DropZone>}</div><label className="sign-check"><input type="checkbox" checked={removeBackground} disabled={locked} onChange={event => setRemoveBackground(event.target.checked)} /> Remove white background</label>{imageBusy && <div className="sign-image-status" role="status"><LoaderCircle size={14} className="sign-spin" /> Preparing image…</div>}{imageError && <p className="sign-error" role="alert">{imageError}</p>}</>}
        {mode !== 'image' && <fieldset className="sign-ink-controls" disabled={locked}><span>Ink</span>{[['#172b27', 'Black'], ['#17479e', 'Blue'], ['#8a2535', 'Red']].map(([color, label]) => <button key={color} aria-label={`${label} ink`} aria-pressed={ink === color} style={{ '--ink': color }} onClick={() => setInk(color)} />)}<input aria-label="Custom ink color" type="color" value={ink} onChange={event => setInk(event.target.value)} />{mode === 'draw' && <input aria-label="Pen width" type="range" min={2} max={14} step={1} value={penWidth} onChange={event => setPenWidth(Number(event.target.value))} />}</fieldset>}
        <button className="btn btn-primary sign-add" disabled={locked || !ready || !draft} onClick={() => addDraft(false)}><Plus size={16} /> Add signature</button>
        {selected && <button className="sign-replace" disabled={locked || !draft || !ready} onClick={() => addDraft(true)}>Replace selected</button>}
        {assets.length > 0 && <section className="sign-library" aria-label="Reusable signatures"><h3>Reuse</h3><div>{assets.map(asset => <button key={asset.id} disabled={locked || !ready} title={`Add ${asset.label}`} aria-label={`Add ${asset.label}`} onClick={() => place(asset)}><img src={asset.dataUrl} alt={asset.label} /></button>)}</div></section>}
        <div className="sign-date"><input type="date" aria-label="Date to add" value={date} disabled={locked} onChange={event => setDate(event.target.value)} /><button className="btn btn-secondary btn-sm" disabled={locked || !ready || !date} onClick={addDate}><CalendarDays size={14} /> Add date</button></div>
        {selected && <div className="sign-repeat"><input className="form-input" autoComplete="off" aria-label="Pages to copy selected signature to" placeholder="All pages · or 1-3, 5" value={copyRange} disabled={locked} onChange={event => setCopyRange(event.target.value)} /><button className="btn btn-secondary btn-sm" disabled={locked || !ready} onClick={repeat}><Copy size={14} /> Copy to pages</button></div>}
      </aside><section className="sign-review" aria-label="PDF signing workspace">
        <div className="sign-page-toolbar"><div className="sign-page-nav"><IconButton icon={ChevronLeft} label="Previous page" disabled={locked || page === 1} onClick={() => changePage(page - 1)} /><label><input aria-label="Page number" inputMode="numeric" value={pageInput} disabled={locked} onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))} onBlur={() => { changePage(pageInput); setPageInput(String(clamp(Number(pageInput) || page, 1, source.pdf.numPages))) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /> / {source.pdf.numPages}</label><IconButton icon={ChevronRight} label="Next page" disabled={locked || page === source.pdf.numPages} onClick={() => changePage(page + 1)} /></div><div className="sign-object-tools"><IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={locked || !history.past.length} onClick={undo} /><IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={locked || !history.future.length} onClick={redo} /><IconButton icon={Copy} label="Duplicate selected signature" disabled={locked || !selected} onClick={duplicate} /><IconButton icon={Trash2} label="Delete selected signature" disabled={locked || !selected} onClick={remove} /><IconButton icon={RotateCcw} label="Reset placements" disabled={locked || !history.items.length} onClick={() => { commit([]); setSelectedId(null) }} /></div><div className="sign-zoom"><IconButton icon={ZoomOut} label="Zoom out" disabled={locked || zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))} /><button title="Fit width" disabled={locked} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><IconButton icon={ZoomIn} label="Zoom in" disabled={locked || zoom >= 2.5} onClick={() => setZoom(value => Math.min(2.5, value + .25))} /></div></div>
        <SignPdfCanvas source={source} page={page} zoom={zoom} items={history.items} selectedId={selectedId} onSelect={setSelectedId} onTransient={transient} onFinish={finishGesture} onGeometry={setGeometry} disabled={locked} />
        {source.pdf.numPages > 1 && <nav className="sign-page-strip" aria-label="PDF pages">{Array.from({ length: source.pdf.numPages }, (_, index) => { const num = index + 1; return <button key={num} disabled={locked} aria-label={`Page ${num}${pageCounts.has(num) ? ', signed' : ''}`} aria-current={page === num ? 'page' : undefined} className={page === num ? 'active' : ''} onClick={() => changePage(num)}><PdfPageThumbnail pdf={source.pdf} page={{ num, rotation: 0 }} /><span>{num}{pageCounts.has(num) && <b>{pageCounts.get(num)}</b>}</span></button> })}</nav>}
      </section></div>
    </>}
    {loading && <p className="sign-loading" role="status"><LoaderCircle size={16} className="sign-spin" /> Opening PDF…</p>}
    {busy && <div className="sign-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={() => { operation.current?.abort(); operation.current = null; setBusy(false) }}><X size={14} /> Cancel</button></div>}
    {error && <p className="sign-error" role="alert">{error}</p>}
    <Modal open={!!preview} onClose={() => setPreview(null)} title="Signed PDF" maxWidth={1000} footer={<button className="btn btn-primary" onClick={() => { downloadBlob(preview.blob, `signed-${source.file.name}`); setSavedItems(preview.items) }}><Download size={16} /> Download PDF</button>}><DocumentPdfPreview blob={preview?.blob} initialPage={page} heading="Signed PDF preview" /></Modal>
  </div></ToolPage>
}
